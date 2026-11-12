import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
    berechne,
    nachName,
    type ListenOptionen,
    type ListenStand,
    type ListenZeile,
} from "../src/editor-liste/liste-modell.ts";
import {
    alleAnhaken,
    ausschalten,
    einschalten,
    einschaltenMitBereich,
    klickeHaken,
    klickeKontext,
    ohneKontext,
    umschalteAufKarte,
    waehlbareReihe,
} from "../src/editor-liste/mehrfachauswahl.ts";
import { createSammelEntwurf, ueberAlle } from "../src/fenster/sammel.ts";

/**
 * Die Mehrfachauswahl (EDIT-0003 T57, Fassung 5 der Gebiete, Betreiber 2026-10-19: „perfekt genau das wollen wir“). Problemfälle: Ein
 * Klick wählt nur noch eins statt anzuhaken; Umschalt hakt den Bereich nicht an oder vergisst die schon angehakten; Ausschalten lässt
 * mehrere gewählt oder das falsche; ein gemischtes Feld liest sich als gleich; „Fertig“ schreibt je Objekt statt EINMAL, oder ein
 * Fehler des Servers verwirft den Entwurf.
 */
const REIHE = ["a", "b", "c", "d", "e"];

describe("Mehrfachauswahl der Liste", () => {
    it("🔴 ein Klick hakt an und wieder ab; der Anker ist die zuletzt angeklickte Zeile", () => {
        let stand = klickeHaken({ angehakt: [], anker: undefined }, "b", false, REIHE);
        expect(stand).toEqual({ angehakt: ["b"], anker: "b" });
        stand = klickeHaken(stand, "d", false, REIHE);
        expect(stand).toEqual({ angehakt: ["b", "d"], anker: "d" });
        stand = klickeHaken(stand, "b", false, REIHE);
        expect(stand).toEqual({ angehakt: ["d"], anker: "b" });
    });

    it("🔴 Umschalt hakt alle zwischen Anker und Zeile an, in beide Richtungen, und behält die schon angehakten", () => {
        expect(klickeHaken({ angehakt: ["a"], anker: "b" }, "d", true, REIHE)).toEqual({
            angehakt: ["a", "b", "c", "d"],
            anker: "d",
        });
        expect(klickeHaken({ angehakt: [], anker: "e" }, "c", true, REIHE).angehakt).toEqual(["c", "d", "e"]);
        // Ohne Anker in der Reihe (weggefiltert): wie ein Klick ohne Umschalt.
        expect(klickeHaken({ angehakt: [], anker: "x" }, "c", true, REIHE)).toEqual({ angehakt: ["c"], anker: "c" });
    });

    it("„Alle n“ hakt alle Treffer an; ein- und ausschalten lassen genau eins gewählt", () => {
        expect(alleAnhaken(["d"], REIHE)).toEqual(["d", "a", "b", "c", "e"]);
        expect(einschalten("c")).toEqual(["c"]);
        expect(einschalten(undefined)).toEqual([]);
        expect(ausschalten(["a", "c", "e"], "c")).toEqual(["c"]);
        expect(ausschalten(["a", "c"], "x")).toEqual(["a"]);
        expect(ausschalten([], "x")).toEqual([]);
    });
});

describe("Felder der Mehrfachauswahl", () => {
    const gebiete = [
        { id: "g1", art: "Grafschaft", farbe: "#111111" },
        { id: "g2", art: "Grafschaft", farbe: "#222222" },
    ];

    it("🔴 gleich mit Wert oder gemischt; ohne Objekte gemischt", () => {
        expect(ueberAlle(gebiete, (g) => g.art)).toEqual({ gleich: true, wert: "Grafschaft" });
        expect(ueberAlle(gebiete, (g) => g.farbe)).toEqual({ gleich: false });
        expect(ueberAlle([], () => 1)).toEqual({ gleich: false });
    });

    it("🔴 „Fertig“ schreibt EINMAL für alle gewählten: nur die geänderten Felder und die Wiki-Felder, danach leer", async () => {
        const quittung = {
            operationId: "op",
            status: "applied" as const,
            environment: "test",
            affected: [],
            derivedWork: [],
            warnings: [],
            mapRevision: 12,
        };
        const schreibe = vi.fn(async () => ({ ok: true as const, quittung }));
        const geschrieben = vi.fn();
        const entwurf = createSammelEntwurf<{ art: string; farbe: string }>({ schreibe }, ["g1", "g2"], {
            neueKennung: () => "k1",
            geschrieben,
        });
        expect(entwurf.lage.value).toMatchObject({ aktiv: false, ungespeichert: 0 });
        entwurf.setze("art", "Baron");
        entwurf.setze("art", "Baronie");
        entwurf.aufWiki("ruler");
        // Tippen in dasselbe Feld ist ein Schritt, ↺ ein zweiter.
        expect(entwurf.lage.value).toMatchObject({ aktiv: true, ungespeichert: 2 });
        expect(entwurf.geaendert("art")).toBe(true);
        expect(entwurf.geaendert("farbe")).toBe(false);
        expect(entwurf.geaendert("ruler")).toBe(true);
        await entwurf.fertig();
        expect(schreibe).toHaveBeenCalledTimes(1);
        expect(schreibe).toHaveBeenCalledWith(["g1", "g2"], { felder: { art: "Baronie" }, wiki: ["ruler"] }, "k1");
        expect(entwurf.zustand.value).toMatchObject({ art: "gespeichert", mapRevision: 12 });
        expect(entwurf.lage.value).toMatchObject({ aktiv: false, ungespeichert: 0 });
        expect(geschrieben).toHaveBeenCalledWith(quittung);
    });

    it("🔴 lehnt der Server ab, bleibt der Entwurf und die Leiste nennt den Satz; ↶ nimmt den letzten Schritt", async () => {
        const schreibe = vi.fn(async () => ({
            ok: false as const,
            status: 409,
            fehler: { code: "object_locked", message: "Thomas bearbeitet Grafschaft Isenhag." },
        }));
        const entwurf = createSammelEntwurf<{ status: string }>({ schreibe }, ["g1", "g2"]);
        entwurf.setze("status", "Lehen");
        await entwurf.fertig();
        expect(entwurf.zustand.value).toEqual({
            art: "abgelehnt",
            code: "object_locked",
            satz: "Thomas bearbeitet Grafschaft Isenhag.",
        });
        expect(entwurf.stand.value.felder).toEqual({ status: "Lehen" });
        entwurf.zurueck();
        expect(entwurf.stand.value.felder).toEqual({});
        // Ohne Änderung schreibt „Fertig“ nichts.
        await entwurf.fertig();
        expect(schreibe).toHaveBeenCalledTimes(1);
    });
});

describe("Umschalt-Klick (Betreiber 2026-10-20: „die mehrfach auswahl könnte übrigens auch durch gedrückte shift-taste unterstützt werden“)", () => {
    it("🔴 in der Liste bei ausgeschalteter Mehrfachauswahl: an, und der Bereich vom gewählten bis zur Zeile ist angehakt", () => {
        expect(einschaltenMitBereich("b", "d", REIHE)).toEqual(["b", "c", "d"]);
        expect(einschaltenMitBereich("d", "b", REIHE)).toEqual(["d", "b", "c"]);
        // Ohne gewählte Zeile nur die angeklickte.
        expect(einschaltenMitBereich(undefined, "c", REIHE)).toEqual(["c"]);
    });

    it("🔴 auf der Karte: aus eingeschaltet mit dem gewählten als erstem, an aufnehmen oder herausnehmen, keine Bereiche", () => {
        expect(umschalteAufKarte({ an: false, angehakt: [] }, "a", "c")).toEqual(["a", "c"]);
        expect(umschalteAufKarte({ an: false, angehakt: [] }, undefined, "c")).toEqual(["c"]);
        expect(umschalteAufKarte({ an: true, angehakt: ["a", "c"] }, "a", "e")).toEqual(["a", "c", "e"]);
        expect(umschalteAufKarte({ an: true, angehakt: ["a", "c", "e"] }, "a", "c")).toEqual(["a", "e"]);
    });
});

describe("🔴 Kontext-Zeilen sind nie wählbar (Fund 2026-10-25: Thorwal und Orkreich standen als Kontext in der Suche und wurden mit „Alle n“ gelöscht)", () => {
    const zeile = (key: string, name: string, eltern?: string): ListenZeile => ({
        key,
        name,
        kreis: "voll",
        facetten: {},
        ...(eltern === undefined ? {} : { eltern }),
    });
    const GEBIETE: readonly ListenZeile[] = [
        zeile("thorwal", "Thorwal"),
        zeile("jarltum", "Jarltum Prem", "thorwal"),
        zeile("test1", "Neues Herrschaftsgebiet", "thorwal"),
        zeile("test2", "Neues Herrschaftsgebiet 2", "test1"),
        zeile("orkreich", "Orkreich"),
        zeile("test3", "Neues Herrschaftsgebiet 3", "orkreich"),
        zeile("test4", "Neues Herrschaftsgebiet 4"),
    ];
    const optionen: ListenOptionen = { form: "baum", facetten: [], sortierungen: { name: nachName } };
    const stand = (suche: string): ListenStand => ({
        suche,
        filter: new Map(),
        sortierung: "name",
        offen: new Set(),
    });
    const darstellung = berechne(GEBIETE, stand("neues herrschaftsgebiet"), optionen).darstellung;

    it("die Suche zeigt Thorwal und Orkreich nur als Kontext; wählbar sind die vier Treffer, in der Folge der Liste", () => {
        expect(darstellung.map((x) => [x.key, x.art === "zeile" && x.zusammenhang === true])).toEqual([
            ["test4", false],
            ["orkreich", true],
            ["test3", false],
            ["thorwal", true],
            ["test1", false],
            ["test2", false],
        ]);
        // Die Reihe ist zugleich die Zahl in „Alle n“: 4, nicht 6.
        expect(waehlbareReihe(darstellung)).toEqual(["test4", "test3", "test1", "test2"]);
    });

    it("„Alle n“ und Strg+A (beide: alleAnhaken über die wählbare Reihe) hakt keine Kontext-Zeile an und behält vorhandene Haken", () => {
        const reihe = waehlbareReihe(darstellung);
        expect(alleAnhaken([], reihe)).toEqual(["test4", "test3", "test1", "test2"]);
        expect(alleAnhaken(["test1"], reihe)).toEqual(["test1", "test4", "test3", "test2"]);
        expect(alleAnhaken([], reihe)).not.toContain("thorwal");
        expect(alleAnhaken([], reihe)).not.toContain("orkreich");
    });

    it("der Umschalt-Bereich überspringt die Kontext-Zeilen dazwischen", () => {
        const reihe = waehlbareReihe(darstellung);
        // test4 bis test1 liegt in der Darstellung über Orkreich und Thorwal; angehakt werden nur die Treffer.
        expect(klickeHaken({ angehakt: [], anker: "test4" }, "test1", true, reihe).angehakt).toEqual([
            "test4",
            "test3",
            "test1",
        ]);
        // Liegt der Anker auf einer Kontext-Zeile, wird der Umschalt-Klick wie ein einfacher Klick, nie ein Bereich mit ihr.
        expect(klickeHaken({ angehakt: [], anker: "thorwal" }, "test2", true, reihe).angehakt).toEqual(["test2"]);
        // Aus ausgeschalteter Mehrfachauswahl heraus ebenso: Eine Kontext-Zeile wird nicht das erste Häkchen.
        expect(einschaltenMitBereich(ohneKontext("thorwal", darstellung), "test2", reihe)).toEqual(["test2"]);
        expect(einschalten(ohneKontext("thorwal", darstellung))).toEqual([]);
        expect(einschalten(ohneKontext("test1", darstellung))).toEqual(["test1"]);
        // Was gar nicht in der Darstellung steht (weggefiltert, von der Karte gewählt), bleibt wie bisher.
        expect(ohneKontext("weggefiltert", darstellung)).toBe("weggefiltert");
    });

    it("ein Klick auf eine Kontext-Zeile hakt nie an; ein schon gesetzter Haken lässt sich lösen", () => {
        expect(klickeKontext(["test1"], "thorwal")).toEqual(["test1"]);
        expect(klickeKontext([], "thorwal")).toEqual([]);
        expect(klickeKontext(["test1", "thorwal"], "thorwal")).toEqual(["test1"]);
    });

    it("🔴 die Liste baut „Alle n“, Strg+A und den Umschalt-Bereich aus derselben wählbaren Reihe und leitet Kontext-Klicks um", () => {
        const quelle = readFileSync(new URL("../src/editor-liste/editor-liste.vue", import.meta.url), "utf8");
        // Die Reihe kommt aus waehlbareReihe, nicht aus allen Zeilen der Darstellung.
        expect(quelle).toContain("const reihe = computed(() => waehlbareReihe(darstellung.value));");
        // Strg+A und der Knopf gehen beide durch alleHaken(), das nur reihe.value hakt.
        const eingedampft = quelle.replace(/\s+/g, " ");
        expect(eingedampft).toContain('event.key.toLowerCase() === "a") { event.preventDefault(); alleHaken();');
        expect(quelle).toContain("alleAnhaken(angehakt.value, reihe.value)");
        // Der Klick auf eine Kontext-Zeile geht nicht durch klickeHaken.
        expect(quelle).toContain("? klickeKontext(angehakt.value, key)");
        expect(quelle).toContain("formatNumber(reihe.length, 0)");
    });
});
