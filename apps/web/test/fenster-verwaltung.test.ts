import { describe, expect, it, vi } from "vitest";
import { nextTick, ref, watch } from "vue";
import { alsMehrfachauswahl, imMehrfachauswahlHandgriff } from "../src/editor-liste/mehrfachauswahl";
import {
    LEERER_STAND,
    abgelegt,
    alleSchliessen,
    angedockt,
    ausInfoZurueck,
    hervorholen,
    infoLasche,
    leseGemerkt,
    markiere,
    nachVorn,
    oeffne,
    oeffneAnStelle,
    schliesse,
    schliesseAlle,
    schliesseZeile,
    setzeLage,
    verwirf,
    vorderstes,
    type FensterStand,
} from "../src/editor-panel/fenster-verwaltung";
import { createWerkzeugfenster } from "../src/editor-panel/werkzeugfenster";
import { begrenzeBox, loestSich } from "../src/fenster/fenster-lage";

/**
 * Die Fensterverwaltung des Editorpanels (WI-0128 E6, EDIT-0001 §7.1 E6, T6.2 bis T6.5; D14, D15, D19; Bedingung (a) der
 * Koordination 2026-10-10).
 */
const ORT = (gegenstand: string, extra = {}) => ({
    werkzeug: "ortseditor",
    gegenstand,
    titel: `Orte bearbeiten · ${gegenstand}`,
    nurLesen: false,
    ...extra,
});

function mit(...orte: string[]): { stand: FensterStand; ids: string[] } {
    let stand = LEERER_STAND;
    const ids: string[] = [];
    for (const ort of orte) {
        const r = oeffne(stand, ORT(ort));
        stand = r.stand;
        ids.push(r.id);
    }
    return { stand, ids };
}

const lagen = (stand: FensterStand): Record<string, string> =>
    Object.fromEntries(stand.fenster.map((fenster) => [fenster.gegenstand ?? fenster.id, fenster.lage]));

describe("Lagen und die eine Stelle rechts (D14, D15)", () => {
    it("🔴 ein neues Fenster dockt an; ein zweites angedocktes legt das erste ab (T6.5)", () => {
        const { stand } = mit("gratenfels", "ferdok");
        expect(lagen(stand)).toEqual({ gratenfels: "versenkt", ferdok: "angedockt" });
        expect(abgelegt(stand).map((x) => x.gegenstand)).toEqual(["gratenfels"]);
        expect(abgelegt(stand)[0]?.letzteLage).toBe("angedockt");
    });

    it("🔴 mehrere Fenster derselben Art: eins angedockt, eins gelöst nebeneinander", () => {
        const { stand, ids } = mit("gratenfels", "ferdok");
        const geloest = setzeLage(stand, ids[0]!, "geloest", { left: 40, top: 60, width: 600, height: 400 });
        expect(lagen(geloest)).toEqual({ gratenfels: "geloest", ferdok: "angedockt" });
        expect(vorderstes(geloest)?.gegenstand).toBe("gratenfels");
        expect(geloest.fenster.find((x) => x.id === ids[0])?.box).toEqual({
            left: 40,
            top: 60,
            width: 600,
            height: 400,
        });
    });

    it("🔴 „▣ Hervorholen“ kehrt in die letzte Lage zurück und legt dabei das angedockte ab (T6.2)", () => {
        const { stand, ids } = mit("gratenfels");
        const geloest = setzeLage(stand, ids[0]!, "geloest");
        const versenkt = setzeLage(geloest, ids[0]!, "versenkt");
        expect(versenkt.fenster[0]).toMatchObject({ lage: "versenkt", letzteLage: "geloest" });
        expect(hervorholen(versenkt, ids[0]!).fenster[0]?.lage).toBe("geloest");

        const zwei = mit("gratenfels", "ferdok");
        const zurueck = hervorholen(zwei.stand, zwei.ids[0]!);
        expect(lagen(zurueck)).toEqual({ gratenfels: "angedockt", ferdok: "versenkt" });
    });

    it("🔴 die Lasche „Info“ legt das angedockte Fenster ab, ein gelöstes bleibt (T6.3)", () => {
        const { stand, ids } = mit("gratenfels", "ferdok");
        const geloest = setzeLage(stand, ids[0]!, "geloest");
        expect(lagen(infoLasche(geloest))).toEqual({ gratenfels: "geloest", ferdok: "versenkt" });
        expect(angedockt(infoLasche(geloest))).toBeUndefined();
    });

    it("🔴 die Lasche „Editor“ holt zurück, was die Lasche „Info“ abgelegt hat, sonst nichts (E7, §4.5 Nr. 6)", () => {
        const { stand, ids } = mit("gratenfels");
        const abgelegtStand = infoLasche(stand);
        expect(lagen(ausInfoZurueck(abgelegtStand, ids[0]))).toEqual({ gratenfels: "angedockt" });
        // Inzwischen steht rechts ein anderes: Das bleibt, das abgelegte auch.
        const anderes = oeffne(abgelegtStand, ORT("ferdok")).stand;
        expect(lagen(ausInfoZurueck(anderes, ids[0]))).toEqual({ gratenfels: "versenkt", ferdok: "angedockt" });
        // Ohne Abgelegtes oder mit einem Fenster, das inzwischen anderswo steht, geschieht nichts.
        expect(ausInfoZurueck(abgelegtStand, undefined)).toBe(abgelegtStand);
        const geloest = setzeLage(abgelegtStand, ids[0]!, "geloest");
        expect(ausInfoZurueck(geloest, ids[0])).toBe(geloest);
    });

    it("ein Klick auf ein gelöstes Fenster holt es nach vorn, ohne die Lage zu ändern", () => {
        const { stand, ids } = mit("gratenfels", "ferdok");
        const geloest = setzeLage(setzeLage(stand, ids[0]!, "geloest"), ids[1]!, "geloest");
        expect(vorderstes(geloest)?.gegenstand).toBe("ferdok");
        expect(vorderstes(nachVorn(geloest, ids[0]!))?.gegenstand).toBe("gratenfels");
        expect(lagen(nachVorn(geloest, ids[0]!))).toEqual({ gratenfels: "geloest", ferdok: "geloest" });
    });
});

describe("🔴 ein Gegenstand, eine Bearbeitung (WI-0126 §11h)", () => {
    it("ein Ort, der schon offen ist, kommt nach vorn, statt ein zweites Fenster zu bekommen", () => {
        const { stand, ids } = mit("gratenfels", "ferdok");
        const wieder = oeffne(stand, ORT("gratenfels"));
        expect(wieder.id).toBe(ids[0]);
        expect(wieder.stand.fenster).toHaveLength(2);
        expect(lagen(wieder.stand)).toEqual({ gratenfels: "angedockt", ferdok: "versenkt" });
    });
});

describe("🔴 öffnen und ablegen (D19)", () => {
    it("ein Klick in der Liste öffnet an der Stelle des Fensters; das bisherige wandert mit Entwurf nach „Offene Bearbeitungen“", () => {
        const { stand, ids } = mit("gratenfels");
        const mitEntwurf = markiere(stand, ids[0]!, { ungespeichert: true });
        const r = oeffneAnStelle(mitEntwurf, ids[0], ORT("ferdok"));
        expect(lagen(r.stand)).toEqual({ gratenfels: "versenkt", ferdok: "angedockt" });
        expect(r.stand.fenster.find((x) => x.gegenstand === "gratenfels")?.ungespeichert).toBe(true);
        expect(r.id).not.toBe(ids[0]);
    });

    it("an der Stelle eines gelösten Fensters öffnet der neue Ort gelöst, mit derselben Box", () => {
        const { stand, ids } = mit("gratenfels");
        const box = { left: 10, top: 20, width: 700, height: 500 };
        const geloest = setzeLage(stand, ids[0]!, "geloest", box);
        const r = oeffneAnStelle(geloest, ids[0], ORT("ferdok"));
        expect(r.stand.fenster.find((x) => x.id === r.id)).toMatchObject({ lage: "geloest", box });
        expect(r.stand.fenster.find((x) => x.id === ids[0])).toMatchObject({ lage: "versenkt", letzteLage: "geloest" });
    });

    it("ist der Ort schon abgelegt, tauschen die beiden die Plätze", () => {
        const { stand, ids } = mit("gratenfels", "ferdok");
        const r = oeffneAnStelle(stand, ids[1], ORT("gratenfels"));
        expect(r.id).toBe(ids[0]);
        expect(lagen(r.stand)).toEqual({ gratenfels: "angedockt", ferdok: "versenkt" });
    });

    it("ein leeres Fenster übernimmt den Ort selbst, statt als leere Zeile abgelegt zu werden", () => {
        const leer = oeffne(LEERER_STAND, {
            werkzeug: "ortseditor",
            gegenstand: undefined,
            titel: "Ortseditor",
            nurLesen: false,
        });
        const r = oeffneAnStelle(leer.stand, leer.id, ORT("gratenfels"));
        expect(r.id).toBe(leer.id);
        expect(r.stand.fenster).toHaveLength(1);
        expect(r.stand.fenster[0]).toMatchObject({
            gegenstand: "gratenfels",
            titel: "Orte bearbeiten · gratenfels",
            lage: "angedockt",
        });
    });

    it("ist der Ort schon in einer anderen Bearbeitung, tritt diese an die Stelle des leeren Fensters", () => {
        const { stand, ids } = mit("gratenfels");
        const geloest = setzeLage(stand, ids[0]!, "geloest");
        const leer = oeffne(geloest, {
            werkzeug: "ortseditor",
            gegenstand: undefined,
            titel: "Ortseditor",
            nurLesen: false,
        });
        const r = oeffneAnStelle(leer.stand, leer.id, ORT("gratenfels"));
        expect(r.id).toBe(ids[0]);
        expect(r.stand.fenster.map((x) => [x.gegenstand, x.lage])).toEqual([["gratenfels", "angedockt"]]);
    });

    it("ohne Fenster an der Stelle öffnet es neu, angedockt", () => {
        const r = oeffneAnStelle(LEERER_STAND, undefined, ORT("gratenfels"));
        expect(lagen(r.stand)).toEqual({ gratenfels: "angedockt" });
    });
});

describe("🔴 In der Mehrfachauswahl schließt ein Fenster ohne Entwurf, statt abgelegt zu werden (Editor-Orchestrierung 2026-10-19, Fund 2)", () => {
    it("ohne Entwurf übernimmt dasselbe Fenster den neuen Gegenstand (Lage, Box, Kennung bleiben); mit Entwurf wird es abgelegt wie immer", () => {
        const { stand, ids } = mit("gratenfels");
        const box = { left: 10, top: 20, width: 700, height: 500 };
        const geloest = setzeLage(stand, ids[0]!, "geloest", box);
        const zu = oeffneAnStelle(geloest, ids[0], ORT("ferdok"), { ohneEntwurfSchliessen: true });
        expect(zu.stand.fenster.map((x) => [x.gegenstand, x.lage])).toEqual([["ferdok", "geloest"]]);
        expect(zu.stand.fenster[0]?.box).toEqual(box);
        expect(zu.id).toBe(ids[0]);

        const mitEntwurf = markiere(stand, ids[0]!, { ungespeichert: true });
        const ab = oeffneAnStelle(mitEntwurf, ids[0], ORT("ferdok"), { ohneEntwurfSchliessen: true });
        expect(lagen(ab.stand)).toEqual({ gratenfels: "versenkt", ferdok: "angedockt" });
        expect(ab.stand.fenster.find((x) => x.gegenstand === "gratenfels")?.ungespeichert).toBe(true);
    });

    it("steht der neue Gegenstand schon abgelegt, kommt er an die Stelle, und das bisherige ohne Entwurf geht zu", () => {
        const { stand, ids } = mit("gratenfels", "ferdok");
        const r = oeffneAnStelle(stand, ids[1], ORT("gratenfels"), { ohneEntwurfSchliessen: true });
        expect(r.id).toBe(ids[0]);
        expect(lagen(r.stand)).toEqual({ gratenfels: "angedockt" });
    });

    it("das Fenster fragt den Handgriff der Liste selbst, auch in einem watch auf die Häkchen; danach legt es wieder ab", async () => {
        const werkzeugfenster = createWerkzeugfenster(undefined);
        const erstes = werkzeugfenster.oeffne(ORT("gratenfels"));
        const angehakt = ref<string[]>([]);
        // Wie die Gebiete: genau eins angehakt öffnet es am Fenster, im nächsten Durchlauf von Vue.
        const stop = watch(angehakt, (neu) => {
            if (neu.length === 1) werkzeugfenster.oeffneAnStelle(werkzeugfenster.vorderstes.value?.id, ORT(neu[0]!));
        });
        alsMehrfachauswahl(() => (angehakt.value = ["ferdok"]));
        expect(imMehrfachauswahlHandgriff()).toBe(true);
        await nextTick();
        expect(werkzeugfenster.stand.value.fenster.map((x) => [x.gegenstand, x.lage])).toEqual([
            ["ferdok", "angedockt"],
        ]);
        // Dasselbe Fenster übernimmt den Gegenstand: Was der Editor je Fenster hält (die Häkchen), bleibt.
        expect(werkzeugfenster.stand.value.fenster[0]?.id).toBe(erstes);
        await nextTick();
        expect(imMehrfachauswahlHandgriff()).toBe(false);

        // Ein gewöhnlicher Klick in der Liste legt ab (D19).
        werkzeugfenster.oeffneAnStelle(werkzeugfenster.vorderstes.value?.id, ORT("albenhus"));
        expect(lagen(werkzeugfenster.stand.value)).toEqual({ ferdok: "versenkt", albenhus: "angedockt" });
        stop();
    });
});

describe("🔴 Schließen verwirft nie ohne Frage (Koordination 2026-10-10, Betreiber F1; WI-0231)", () => {
    it("✕ im Fenster: ohne Änderungen schließt es; mit Änderungen legt es mit Entwurf ab", () => {
        const { stand, ids } = mit("gratenfels", "ferdok");
        expect(schliesse(stand, ids[1]!).fenster.map((x) => x.gegenstand)).toEqual(["gratenfels"]);
        const entwurf = markiere(stand, ids[1]!, { ungespeichert: true });
        const zu = schliesse(entwurf, ids[1]!);
        expect(lagen(zu)).toEqual({ gratenfels: "versenkt", ferdok: "versenkt" });
        expect(zu.fenster.find((x) => x.id === ids[1])?.ungespeichert).toBe(true);
    });

    it("„Alle schließen“ schließt, was sauber ist, und lässt jeden Entwurf abgelegt stehen", () => {
        const { stand, ids } = mit("gratenfels", "ferdok", "albenhus");
        const entwurf = markiere(stand, ids[1]!, { ungespeichert: true });
        const nachher = alleSchliessen(entwurf);
        expect(nachher.fenster.map((x) => [x.gegenstand, x.lage])).toEqual([["ferdok", "versenkt"]]);
    });

    it("nur „Verwerfen“ verwirft", () => {
        const { stand, ids } = mit("gratenfels");
        const entwurf = markiere(stand, ids[0]!, { ungespeichert: true });
        expect(verwirf(entwurf, ids[0]!).fenster).toEqual([]);
    });
});

/**
 * 🔴 „Offene Bearbeitungen“ fragt (Betreiber 2026-10-19 über die Editor-Orchestrierung, wörtlich: „ich habe in einem fenster noch offene
 * bearbeitungen. alle schließen und X haben keinen effekt“; Entscheidung: „pop up mit ".... trotzdem schließen? ok, abbrechen"“).
 * Problemfall: ✕ an einer abgelegten Zeile mit Entwurf legte sie noch einmal ab, also geschah nichts, ohne ein Wort.
 */
describe("🔴 ✕ und „Alle schließen“ unter „Offene Bearbeitungen“ fragen bei einem Entwurf (WI-0231)", () => {
    function abgelegtMitEntwurf(): { stand: FensterStand; ids: string[] } {
        const { stand, ids } = mit("gratenfels", "ferdok");
        return { stand: markiere(infoLasche(stand), ids[0]!, { ungespeichert: true }), ids };
    }

    it("💣 vorher: ✕ an der abgelegten Zeile mit Entwurf ändert nichts", () => {
        const { stand, ids } = abgelegtMitEntwurf();
        expect(schliesse(stand, ids[0]!)).toEqual(stand);
    });

    it("1 · ✕ an einem Entwurf fragt mit dem Titel und lässt alles, wie es ist (Abbrechen)", () => {
        const { stand, ids } = abgelegtMitEntwurf();
        const r = schliesseZeile(stand, ids[0]!);
        expect(r.stand).toBe(stand);
        expect(r.frage).toEqual({ ids: [ids[0]], titel: "Orte bearbeiten · gratenfels" });
    });

    it("2 · „OK“ ist Verwerfen: die Zeile ist weg", () => {
        const { stand, ids } = abgelegtMitEntwurf();
        const frage = schliesseZeile(stand, ids[0]!).frage!;
        const nachher = frage.ids.reduce(verwirf, stand);
        expect(nachher.fenster.map((x) => x.gegenstand)).toEqual(["ferdok"]);
    });

    it("3 · ✕ ohne Entwurf geht sofort zu, ohne Frage", () => {
        const { stand, ids } = abgelegtMitEntwurf();
        const r = schliesseZeile(stand, ids[1]!);
        expect(r.frage).toBeUndefined();
        expect(r.stand.fenster.map((x) => x.gegenstand)).toEqual(["gratenfels"]);
    });

    it("4 · „Alle schließen“: die saubere geht sofort zu, die EINE Frage nennt den Entwurf", () => {
        const { stand, ids } = abgelegtMitEntwurf();
        const r = schliesseAlle(stand);
        expect(r.stand.fenster.map((x) => [x.gegenstand, x.lage])).toEqual([["gratenfels", "versenkt"]]);
        expect(r.frage).toEqual({ ids: [ids[0]], titel: undefined });
        expect(schliesseAlle(mit("albenhus").stand).frage).toBeUndefined();
    });

    it("„Alle schließen“ legt einen sichtbaren Entwurf ab, bevor es fragt; zwei Entwürfe, eine Frage", () => {
        const { stand, ids } = mit("gratenfels", "ferdok");
        const beide = markiere(markiere(stand, ids[0]!, { ungespeichert: true }), ids[1]!, { ungespeichert: true });
        const r = schliesseAlle(beide);
        expect(lagen(r.stand)).toEqual({ gratenfels: "versenkt", ferdok: "versenkt" });
        expect(r.frage?.ids).toEqual(ids);
    });

    it("🔴 Verwerfen ruft das Werkzeug, solange das Fenster noch dasteht; Schließen ohne Frage ruft es nicht", () => {
        const werkzeugfenster = createWerkzeugfenster(undefined);
        const sauber = werkzeugfenster.oeffne(ORT("ferdok"));
        const entwurf = werkzeugfenster.oeffne(ORT("gratenfels"));
        werkzeugfenster.markiere(entwurf, { ungespeichert: true });
        const gesehen: string[] = [];
        const tu = vi.fn((fenster: { id: string }) =>
            gesehen.push(
                `${fenster.id}:${String(werkzeugfenster.stand.value.fenster.some((x) => x.id === fenster.id))}`,
            ),
        );
        const ab = werkzeugfenster.beimVerwerfen(tu);
        expect(werkzeugfenster.schliesseZeile(sauber)).toBeUndefined();
        expect(tu).not.toHaveBeenCalled();
        const frage = werkzeugfenster.alleSchliessen()!;
        expect(frage.ids).toEqual([entwurf]);
        for (const id of frage.ids) werkzeugfenster.verwirf(id);
        expect(gesehen).toEqual([`${entwurf}:true`]);
        expect(werkzeugfenster.stand.value.fenster).toEqual([]);
        ab();
        werkzeugfenster.verwirf(werkzeugfenster.oeffne(ORT("albenhus")));
        expect(tu).toHaveBeenCalledTimes(1);
    });
});

describe("Merken und Grenzen (T6.4)", () => {
    it("liest nur eine gültige gemerkte Lage; alles andere ist die Vorgabe", () => {
        expect(leseGemerkt(null)).toBeUndefined();
        expect(leseGemerkt("kaputt")).toBeUndefined();
        expect(leseGemerkt('{"lage":"versenkt"}')).toBeUndefined();
        expect(leseGemerkt('{"lage":"geloest"}')).toEqual({ lage: "geloest" });
        expect(leseGemerkt('{"lage":"geloest","box":{"left":1,"top":2,"width":600,"height":300}}')).toEqual({
            lage: "geloest",
            box: { left: 1, top: 2, width: 600, height: 300 },
        });
        expect(leseGemerkt('{"lage":"angedockt","box":{"left":"x"}}')).toEqual({ lage: "angedockt" });
    });

    it("🔴 der Griff löst erst ab 6 px (T6.1)", () => {
        expect(loestSich(3, 4)).toBe(false);
        expect(loestSich(6, 0)).toBe(true);
        expect(loestSich(4, 5)).toBe(true);
    });

    it("eine Box bleibt im Bild und über der Mindestgröße 520 × 240", () => {
        expect(begrenzeBox({ left: -50, top: 900, width: 100, height: 100 }, { width: 1440, height: 900 })).toEqual({
            left: 0,
            top: 660,
            width: 520,
            height: 240,
        });
        expect(begrenzeBox({ left: 1300, top: 10, width: 800, height: 600 }, { width: 1440, height: 900 })).toEqual({
            left: 640,
            top: 10,
            width: 800,
            height: 600,
        });
    });
});
