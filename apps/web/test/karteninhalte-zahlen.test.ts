import { nextTick, shallowRef } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
    EditorLandscapeList,
    EditorPlaceList,
    EditorPlaceRow,
    EditorPathList,
    EditorPowerlineList,
    EditorTerritoryList,
    InhalteKorporaListe,
    InhalteQuellenListe,
    InhalteVorkommenListe,
    InhalteWerkListe,
    SpracheEditorListe,
} from "@avesmaps3d/shared";
import {
    createKarteninhaltZahlen,
    type KarteninhaltLader,
    type Planung,
} from "../src/editor-panel/karteninhalte-zahlen.ts";
import { inhalteListen, teileInhalteListen } from "../src/inhalte/inhalte-listen.ts";
import type { WetterBestand } from "../src/wettereditor/wetter-editor-modell.ts";

/**
 * Woher die Kacheln „Karteninhalte“ ihre Zahlen haben (WI-0212): aus den Listen der Editoren und des Fensters „Inhalte bearbeiten“, sonst
 * einmal selbst geholt, erst wenn der Reiter zu sehen ist. Benannte Fälle: nichts vor dem ersten Blick; einmal je Seite; die Liste eines
 * Editors oder des Fensters gilt zuerst und löst die eigene ab; ein Fehler lässt die Zahl weg und das nächste Öffnen versucht es noch
 * einmal; gezählt wird mit den Kreisen der Listen, bei den Inhalten zum Nachschlagen aus ihrem `zahlen` (nie aus der Seite).
 */

const sofort: Planung = (arbeit) => {
    arbeit();
    return () => undefined;
};

const ort = (
    key: string,
    origin: EditorPlaceRow["origin"],
    assignment: EditorPlaceRow["assignment"],
): EditorPlaceRow => ({
    key,
    origin,
    name: key,
    circle: "leer",
    assignment,
});
/** Je ein Ort in jedem der vier Zustände der Ortsliste (`kreisVon`), dazu ein zweiter voller. */
const ORTE: EditorPlaceList = {
    wikiListe: true,
    rows: [
        ort("gareth", "karte", "assigned"),
        ort("punin", "karte", "assigned"),
        ort("wiki-dorf", "wiki", "none"),
        ort("ohne-artikel", "karte", "none"),
        ort("neu", "ohne-lage", "none"),
    ],
};
const LANDSCHAFTEN = {
    rows: [
        { id: "a", circle: "voll" },
        { id: "b", circle: "halb-rechts" },
    ],
} as unknown as EditorLandscapeList;
const KRAFTLINIEN = {
    rows: [
        { id: "k1", circle: "voll" },
        { id: "k2", circle: "halb" },
        { id: "k3", circle: "halb" },
    ],
} as unknown as EditorPowerlineList;
/** Die Wege (WI-0177 W5a): eine Straße mit Artikel an jedem Abschnitt, eine ohne. */
const WEGE = {
    rows: [
        { id: "w1", circle: "voll" },
        { id: "w2", circle: "halb-rechts" },
    ],
} as unknown as EditorPathList;
/** Die Herrschaftsgebiete (WI-0209 A3) mit Legacys Kreis über die Untergebiete. */
const GEBIETE = {
    yearBf: 1049,
    rows: [
        { id: "g1", circle: "voll" },
        { id: "g2", circle: "halb-rechts" },
        { id: "g3", circle: "leer" },
        { id: "g4", circle: "leer" },
        // Ganz gelöscht (T54): zählt nicht.
        { id: "g5", circle: "voll", deleted: true },
    ],
} as unknown as EditorTerritoryList;

/**
 * Die Inhalte zum Nachschlagen (WI-0254): Von jeder Liste ist nur die erste Zeile da, aber `zahlen` zählt den ganzen Bestand. Quellen mit
 * einer Handvoll von Hand und stillgelegten, Literatur ebenso, Vorkommen wie auf der Stage (nichts von Hand, nichts unterdrückt), Korpora
 * ohne stillgelegte (die Korpora kennen keine).
 */
const QUELLEN_LISTE = {
    total: 4184,
    items: [{ id: "q1" }],
    zahlen: { aktiv: 4184, editor: 12, stillgelegt: 3 },
} as unknown as InhalteQuellenListe;
const LITERATUR_LISTE = {
    total: 2003,
    items: [{ id: "w1" }],
    zahlen: { aktiv: 2003, editor: 1, stillgelegt: 2 },
} as unknown as InhalteWerkListe;
const VORKOMMEN_LISTE = {
    total: 5138,
    items: [{ id: "v1" }],
    zahlen: { aktiv: 5138, editor: 0, stillgelegt: 0 },
} as unknown as InhalteVorkommenListe;
/** Die Sprachen (WI-0261 S5d2): Der Server zählt die vier Zustände selbst, freie Wiki-Artikel eingeschlossen. */
const SPRACHEN_LISTE = {
    zeilen: [],
    zahlen: { platziertWiki: 9, nurWiki: 80, platziertOhneWiki: 2, leer: 1 },
} as unknown as SpracheEditorListe;
/** Das Wetter (WI-0288 Stufe 3): ein Preset, zwei Icons, eines davon ausgeblendet. */
const WETTER = {
    presets: [{ id: "p-u", tag: null, werte: {}, revision: 0 }],
    symbole: [
        { id: "a", art: "wind", name: "A", nameZeigen: true, sichtbar: true, revision: 0 },
        { id: "b", art: "wirbel", name: null, nameZeigen: false, sichtbar: false, revision: 0 },
    ],
} as unknown as WetterBestand;
const KORPORA_LISTE = {
    total: 12,
    items: [{ id: "k1" }],
    zahlen: { aktiv: 12, editor: 2 },
} as unknown as InhalteKorporaListe;

type Liste =
    | "orte"
    | "landschaften"
    | "kraftlinien"
    | "wege"
    | "herrschaftsgebiete"
    | "sprachen"
    | "quellen"
    | "literatur"
    | "vorkommen"
    | "korpora"
    | "wetter";

/** Die Zahl der Abrufe je Liste, alle gleich (`n`), mit Ausnahmen. */
const abrufeAlle = (n: number, ausser: Partial<Record<Liste, number>> = {}): Record<Liste, number> => ({
    orte: n,
    landschaften: n,
    kraftlinien: n,
    wege: n,
    herrschaftsgebiete: n,
    sprachen: n,
    quellen: n,
    literatur: n,
    vorkommen: n,
    korpora: n,
    wetter: n,
    ...ausser,
});

function aufbau(
    optionen: {
        orte?: EditorPlaceList;
        landschaften?: EditorLandscapeList;
        kraftlinien?: EditorPowerlineList;
        wege?: EditorPathList;
        herrschaftsgebiete?: EditorTerritoryList;
        sprachen?: SpracheEditorListe;
        quellen?: InhalteQuellenListe;
        literatur?: InhalteWerkListe;
        vorkommen?: InhalteVorkommenListe;
        korpora?: InhalteKorporaListe;
        wetter?: WetterBestand;
        /** Alle Listen scheitern (true) oder nur die genannten. */
        fehler?: boolean | readonly string[];
        /** Die Refs der Inhalte, wenn der Test die des Fensters (`inhalteListen`) einhängt. */
        inhalteRefs?: typeof inhalteListen;
    } = {},
    planung: Planung = sofort,
) {
    const quellen = {
        orte: shallowRef<EditorPlaceList | undefined>(optionen.orte),
        landschaften: shallowRef<EditorLandscapeList | undefined>(optionen.landschaften),
        kraftlinien: shallowRef<EditorPowerlineList | undefined>(optionen.kraftlinien),
        wege: shallowRef<EditorPathList | undefined>(optionen.wege),
        herrschaftsgebiete: shallowRef<EditorTerritoryList | undefined>(optionen.herrschaftsgebiete),
        sprachen: shallowRef<SpracheEditorListe | undefined>(optionen.sprachen),
        quellen: optionen.inhalteRefs?.quellen ?? shallowRef<InhalteQuellenListe | undefined>(optionen.quellen),
        literatur: optionen.inhalteRefs?.literatur ?? shallowRef<InhalteWerkListe | undefined>(optionen.literatur),
        vorkommen: optionen.inhalteRefs?.vorkommen ?? shallowRef<InhalteVorkommenListe | undefined>(optionen.vorkommen),
        korpora: optionen.inhalteRefs?.korpora ?? shallowRef<InhalteKorporaListe | undefined>(optionen.korpora),
        wetter: shallowRef<WetterBestand | undefined>(optionen.wetter),
    };
    const abrufe = abrufeAlle(0);
    let fehler: boolean | readonly string[] = optionen.fehler ?? false;
    const antwort = <T>(quelle: string, liste: T): Promise<T> =>
        fehler === true || (Array.isArray(fehler) && fehler.includes(quelle))
            ? Promise.reject(new Error("weg"))
            : Promise.resolve(liste);
    const lader: KarteninhaltLader = {
        orte: () => {
            abrufe.orte += 1;
            return antwort("orte", ORTE);
        },
        landschaften: () => {
            abrufe.landschaften += 1;
            return antwort("landschaften", LANDSCHAFTEN);
        },
        kraftlinien: () => {
            abrufe.kraftlinien += 1;
            return antwort("kraftlinien", KRAFTLINIEN);
        },
        wege: () => {
            abrufe.wege += 1;
            return antwort("wege", WEGE);
        },
        herrschaftsgebiete: () => {
            abrufe.herrschaftsgebiete += 1;
            return antwort("herrschaftsgebiete", GEBIETE);
        },
        sprachen: () => {
            abrufe.sprachen += 1;
            return antwort("sprachen", SPRACHEN_LISTE);
        },
        quellen: () => {
            abrufe.quellen += 1;
            return antwort("quellen", QUELLEN_LISTE);
        },
        literatur: () => {
            abrufe.literatur += 1;
            return antwort("literatur", LITERATUR_LISTE);
        },
        vorkommen: () => {
            abrufe.vorkommen += 1;
            return antwort("vorkommen", VORKOMMEN_LISTE);
        },
        korpora: () => {
            abrufe.korpora += 1;
            return antwort("korpora", KORPORA_LISTE);
        },
        wetter: () => {
            abrufe.wetter += 1;
            return antwort("wetter", WETTER);
        },
    };
    const zahlen = createKarteninhaltZahlen(quellen, lader, planung);
    return { quellen, abrufe, zahlen, heile: () => (fehler = false) };
}

const warte = async (): Promise<void> => {
    await Promise.resolve();
    await nextTick();
};

describe("Wann geladen wird", () => {
    it("🔴 nichts, bevor der Reiter zu sehen ist", async () => {
        const { abrufe, zahlen } = aufbau();
        await warte();
        expect(abrufe).toEqual(abrufeAlle(0));
        expect(zahlen.zaehlung.value).toEqual({});
    });

    it("🔴 einmal je Seite: ein zweites Öffnen lädt nichts nach", async () => {
        const { abrufe, zahlen } = aufbau();
        zahlen.gebraucht();
        await warte();
        zahlen.gebraucht();
        zahlen.gebraucht();
        await warte();
        expect(abrufe).toEqual(abrufeAlle(1));
        expect(zahlen.zaehlung.value.orte?.gesamt).toBe(5);
        expect(zahlen.zaehlung.value.regionen?.gesamt).toBe(2);
    });

    it("🔴 hat ein Editor seine Liste schon, wird sie nicht noch einmal geholt", async () => {
        const { abrufe, zahlen } = aufbau({ orte: ORTE });
        zahlen.gebraucht();
        await warte();
        expect(abrufe).toEqual(abrufeAlle(1, { orte: 0 }));
        expect(zahlen.zaehlung.value.orte?.gesamt).toBe(5);
    });

    it("die Liste eines Editors, die später kommt, gilt vor der eigenen (sie bleibt nach dem Speichern frisch)", async () => {
        const { quellen, zahlen } = aufbau();
        zahlen.gebraucht();
        await warte();
        expect(zahlen.zaehlung.value.orte?.gesamt).toBe(5);
        quellen.orte.value = { wikiListe: true, rows: [...ORTE.rows, ort("neu-2", "karte", "assigned")] };
        await warte();
        expect(zahlen.zaehlung.value.orte?.gesamt).toBe(6);
    });

    it("ein Fehler lässt die Zahl weg; das nächste Öffnen versucht es noch einmal", async () => {
        const { abrufe, zahlen, heile } = aufbau({ fehler: true });
        zahlen.gebraucht();
        await warte();
        expect(zahlen.zaehlung.value).toEqual({});
        heile();
        zahlen.gebraucht();
        await warte();
        expect(abrufe).toEqual(abrufeAlle(2));
        expect(zahlen.zaehlung.value.orte?.gesamt).toBe(5);
    });

    it("nach dem Abbau lädt eine geplante Runde nicht mehr", async () => {
        const runden: (() => void)[] = [];
        const { abrufe, zahlen } = aufbau({}, (arbeit) => {
            runden.push(arbeit);
            return () => runden.splice(runden.indexOf(arbeit), 1);
        });
        zahlen.gebraucht();
        zahlen.destroy();
        for (const runde of runden) runde();
        expect(abrufe).toEqual(abrufeAlle(0));
    });
});

describe("Was gezählt wird", () => {
    it("🔴 die Sprachen (WI-0261 S5d2) mit den vier Zuständen, die der Server zählt, und der Legende aller Editor-Listen", async () => {
        const { zahlen } = aufbau({ sprachen: SPRACHEN_LISTE });
        await warte();
        expect(zahlen.zaehlung.value.sprachen).toEqual({
            gesamt: 92,
            kreise: { voll: 9, halb: 80, "halb-rechts": 2, leer: 1 },
            legende: {
                voll: "platziert und dem Wiki zugewiesen",
                halb: "nur im Wiki, nicht platziert",
                "halb-rechts": "platziert, ohne Wiki-Artikel",
                leer: "nicht platziert, ohne Wiki-Artikel",
            },
        });
    });

    it("🔴 die Orte mit den vier Zuständen ihrer Liste und den Namen ihrer Legende", async () => {
        const { zahlen } = aufbau({ orte: ORTE, landschaften: LANDSCHAFTEN });
        await warte();
        expect(zahlen.zaehlung.value.orte).toEqual({
            gesamt: 5,
            kreise: { voll: 2, halb: 1, "halb-rechts": 1, leer: 1 },
            legende: {
                voll: "platziert und dem Wiki zugewiesen",
                halb: "nur im Wiki, nicht platziert",
                "halb-rechts": "platziert, ohne Wiki-Artikel",
                leer: "nicht platziert, ohne Wiki-Artikel",
            },
        });
    });

    it("🔴 die Wiki-Einträge ohne Fläche (WI-0284) zählen als ◐ zu den Landschaften, wie in der Liste des Editors", async () => {
        const { zahlen } = aufbau({
            landschaften: {
                ...LANDSCHAFTEN,
                wikiEintraege: [{ id: "w1" }, { id: "w2" }],
            } as unknown as EditorLandscapeList,
        });
        await warte();
        expect(zahlen.zaehlung.value.regionen?.gesamt).toBe(4);
        expect(zahlen.zaehlung.value.regionen?.kreise).toEqual({ voll: 1, halb: 2, "halb-rechts": 1, leer: 0 });
    });

    it("die Landschaften und die Kraftlinien mit dem Kreis, den der Server ihnen gibt", async () => {
        const { zahlen } = aufbau({ landschaften: LANDSCHAFTEN, kraftlinien: KRAFTLINIEN });
        await warte();
        expect(zahlen.zaehlung.value.regionen?.kreise).toEqual({ voll: 1, halb: 0, "halb-rechts": 1, leer: 0 });
        expect(zahlen.zaehlung.value.kraftlinien?.gesamt).toBe(3);
        expect(zahlen.zaehlung.value.kraftlinien?.kreise).toEqual({ voll: 1, halb: 2, "halb-rechts": 0, leer: 0 });
    });

    it("🔴 die Herrschaftsgebiete (WI-0209 A3) mit Legacys Kreis über die Untergebiete und dessen Bedeutung; Gelöschtes zählt nicht (T54)", async () => {
        const { zahlen } = aufbau({ herrschaftsgebiete: GEBIETE });
        await warte();
        expect(zahlen.zaehlung.value.territorien?.gesamt).toBe(4);
        expect(zahlen.zaehlung.value.territorien?.kreise).toEqual({ voll: 1, halb: 0, "halb-rechts": 1, leer: 2 });
        expect(zahlen.zaehlung.value.territorien?.legende.halb).toBe("nur über Untergebiete, unvollständig");
    });
});

describe("Das Wetter (WI-0288 Stufe 3)", () => {
    it("🔴 die Kachel zählt Presets und Icons, die Legende nur die Icons (mit Namen, ohne Namen, ausgeblendet)", async () => {
        const { zahlen } = aufbau({ wetter: WETTER });
        await warte();
        expect(zahlen.zaehlung.value.wetter).toEqual({
            gesamt: 3,
            kreise: { voll: 1, halb: 0, "halb-rechts": 0, leer: 1 },
            legende: { voll: "mit Namen", halb: "ohne Namen", leer: "ausgeblendet" },
        });
    });
});

describe("Die Inhalte zum Nachschlagen (WI-0212: Quellen, Literatur, Vorkommen, Korpora)", () => {
    it("🔴 gezählt wird das `zahlen` der Liste (aktive Einträge), nicht ihre geladene Seite, mit den Namen der Legende unter der Liste im Fenster", async () => {
        const { zahlen } = aufbau({
            quellen: QUELLEN_LISTE,
            literatur: LITERATUR_LISTE,
            vorkommen: VORKOMMEN_LISTE,
            korpora: KORPORA_LISTE,
        });
        await warte();
        const alle = {
            voll: "Legacy / Wiki",
            halb: "manuell",
            leer: "unterdrückt",
        };
        // Die Seite hat je eine Zeile; die Kachel nennt die Zahl über den ganzen Bestand.
        expect(zahlen.zaehlung.value.quellen).toEqual({
            gesamt: 4184,
            kreise: { voll: 4172, halb: 12, "halb-rechts": 0, leer: 3 },
            legende: alle,
        });
        expect(zahlen.zaehlung.value.literatur).toEqual({
            gesamt: 2003,
            kreise: { voll: 2002, halb: 1, "halb-rechts": 0, leer: 2 },
            legende: alle,
        });
        // Wie unter der Vorkommen-Liste: „Legacy / Wiki ● 5.138 · manuell ◐ 0 · unterdrückt ○ 0“.
        expect(zahlen.zaehlung.value.vorkommen).toEqual({
            gesamt: 5138,
            kreise: { voll: 5138, halb: 0, "halb-rechts": 0, leer: 0 },
            legende: alle,
        });
    });

    it("die Korpora kennen zwei Kreise: die Legende nennt nur „Legacy / Wiki“ und „manuell“", async () => {
        const { zahlen } = aufbau({ korpora: KORPORA_LISTE });
        await warte();
        expect(zahlen.zaehlung.value.korpora).toEqual({
            gesamt: 12,
            kreise: { voll: 10, halb: 2, "halb-rechts": 0, leer: 0 },
            legende: { voll: "Legacy / Wiki", halb: "manuell" },
        });
    });

    it("🔴 erst wenn der Reiter zu sehen ist, und dann je Liste einmal (nur die erste Seite, nie weitere)", async () => {
        const { abrufe, zahlen } = aufbau();
        await warte();
        expect(zahlen.zaehlung.value.quellen).toBeUndefined();
        zahlen.gebraucht();
        await warte();
        zahlen.gebraucht();
        await warte();
        expect(abrufe).toMatchObject({ quellen: 1, literatur: 1, vorkommen: 1, korpora: 1 });
        expect(zahlen.zaehlung.value.quellen?.gesamt).toBe(4184);
        expect(zahlen.zaehlung.value.literatur?.gesamt).toBe(2003);
        expect(zahlen.zaehlung.value.vorkommen?.gesamt).toBe(5138);
        expect(zahlen.zaehlung.value.korpora?.gesamt).toBe(12);
    });

    it("🔴 scheitert eine dieser Listen (kein Recht, kein Netz), steht nur ihre Kachel ohne Zahl; die anderen zählen weiter", async () => {
        const { abrufe, zahlen, heile } = aufbau({ fehler: ["vorkommen", "korpora"] });
        zahlen.gebraucht();
        await warte();
        expect(zahlen.zaehlung.value.vorkommen).toBeUndefined();
        expect(zahlen.zaehlung.value.korpora).toBeUndefined();
        expect(zahlen.zaehlung.value.quellen?.gesamt).toBe(4184);
        expect(zahlen.zaehlung.value.literatur?.gesamt).toBe(2003);
        expect(zahlen.zaehlung.value.orte?.gesamt).toBe(5);
        // Das nächste Öffnen holt nur, was fehlt.
        heile();
        zahlen.gebraucht();
        await warte();
        expect(abrufe).toEqual(abrufeAlle(1, { vorkommen: 2, korpora: 2 }));
        expect(zahlen.zaehlung.value.vorkommen?.gesamt).toBe(5138);
        expect(zahlen.zaehlung.value.korpora?.gesamt).toBe(12);
    });

    it("🔴 hat das Fenster „Inhalte bearbeiten“ eine Liste geladen, gilt sie zuerst: nichts wird geholt, und jede neue Liste ändert die Zahl", async () => {
        const { quellen, abrufe, zahlen } = aufbau({ quellen: QUELLEN_LISTE });
        zahlen.gebraucht();
        await warte();
        expect(abrufe).toEqual(abrufeAlle(1, { quellen: 0 }));
        expect(zahlen.zaehlung.value.quellen?.gesamt).toBe(4184);
        // Im Fenster wurde eine Quelle angelegt: Die Liste lädt neu, und die Kachel folgt.
        quellen.quellen.value = {
            ...QUELLEN_LISTE,
            zahlen: { aktiv: 4185, editor: 13, stillgelegt: 3 },
        } as InhalteQuellenListe;
        await warte();
        expect(zahlen.zaehlung.value.quellen?.gesamt).toBe(4185);
        expect(zahlen.zaehlung.value.quellen?.kreise.halb).toBe(13);
    });

    it("die Liste des Fensters, die später kommt, löst die eigene ab", async () => {
        const { quellen, zahlen } = aufbau();
        zahlen.gebraucht();
        await warte();
        expect(zahlen.zaehlung.value.literatur?.gesamt).toBe(2003);
        quellen.literatur.value = {
            ...LITERATUR_LISTE,
            zahlen: { aktiv: 2000, editor: 1, stillgelegt: 5 },
        } as InhalteWerkListe;
        await warte();
        expect(zahlen.zaehlung.value.literatur?.gesamt).toBe(2000);
        expect(zahlen.zaehlung.value.literatur?.kreise.leer).toBe(5);
    });
});

describe("Das Fenster reicht seine Listen weiter (`inhalte-listen.ts`)", () => {
    afterEach(() => {
        for (const ref of Object.values(inhalteListen)) ref.value = undefined;
    });

    it("🔴 jede geladene und jede neue Liste des Fensters liegt in `inhalteListen`; eine leere (Laden, Fehler) überschreibt nichts", async () => {
        const fenster = {
            quellen: shallowRef<InhalteQuellenListe | undefined>(undefined),
            literatur: shallowRef<InhalteWerkListe | undefined>(LITERATUR_LISTE),
            vorkommen: shallowRef<InhalteVorkommenListe | undefined>(undefined),
            korpora: shallowRef<InhalteKorporaListe | undefined>(undefined),
        };
        teileInhalteListen(fenster);
        // Was beim Öffnen schon da ist, geht sofort hinüber; was fehlt, bleibt leer.
        expect(inhalteListen.literatur.value).toBe(LITERATUR_LISTE);
        expect(inhalteListen.quellen.value).toBeUndefined();
        fenster.quellen.value = QUELLEN_LISTE;
        await nextTick();
        expect(inhalteListen.quellen.value).toBe(QUELLEN_LISTE);
        // Eine Liste, die neu geholt wird (`undefined` zwischendurch gibt es nicht, ein Fehler lässt die alte stehen).
        fenster.quellen.value = undefined;
        await nextTick();
        expect(inhalteListen.quellen.value).toBe(QUELLEN_LISTE);
    });

    it("🔴 das Panel liest sie wie die Liste eines Editors: Kachel zählt aus der Liste des Fensters, ohne selbst zu laden", async () => {
        const fenster = {
            quellen: shallowRef<InhalteQuellenListe | undefined>(QUELLEN_LISTE),
            literatur: shallowRef<InhalteWerkListe | undefined>(LITERATUR_LISTE),
            vorkommen: shallowRef<InhalteVorkommenListe | undefined>(VORKOMMEN_LISTE),
            korpora: shallowRef<InhalteKorporaListe | undefined>(KORPORA_LISTE),
        };
        teileInhalteListen(fenster);
        const { abrufe, zahlen } = aufbau({ inhalteRefs: inhalteListen });
        zahlen.gebraucht();
        await warte();
        expect(abrufe).toEqual(abrufeAlle(1, { quellen: 0, literatur: 0, vorkommen: 0, korpora: 0 }));
        expect(zahlen.zaehlung.value.quellen?.gesamt).toBe(4184);
        expect(zahlen.zaehlung.value.korpora?.gesamt).toBe(12);
        // Das Fenster lädt nach dem Speichern neu: Die Kachel folgt.
        fenster.vorkommen.value = {
            ...VORKOMMEN_LISTE,
            zahlen: { aktiv: 5139, editor: 1, stillgelegt: 0 },
        } as InhalteVorkommenListe;
        await warte();
        expect(zahlen.zaehlung.value.vorkommen?.gesamt).toBe(5139);
        expect(zahlen.zaehlung.value.vorkommen?.kreise.halb).toBe(1);
    });
});

describe("Der Weg der eigenen Abfrage (ohne Fenster)", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("🔴 holt die vier Listen mit einer Zeile je Seite (`limit=1`) von den Routen der Inhalte, ohne weitere Seiten", async () => {
        const adressen: string[] = [];
        const fetchStub = vi.fn((url: string | URL | Request) => {
            const adresse = String(url);
            adressen.push(adresse);
            const liste = adresse.startsWith("/api/editor/inhalte/quellen")
                ? QUELLEN_LISTE
                : adresse.startsWith("/api/editor/inhalte/literatur")
                  ? LITERATUR_LISTE
                  : adresse.startsWith("/api/editor/inhalte/vorkommen")
                    ? VORKOMMEN_LISTE
                    : adresse.startsWith("/api/editor/inhalte/korpora")
                      ? KORPORA_LISTE
                      : undefined;
            // Die Listen der Editoren interessieren hier nicht: Sie scheitern, also steht ihre Kachel ohne Zahl.
            return Promise.resolve(
                liste === undefined
                    ? new Response("{}", { status: 500 })
                    : new Response(JSON.stringify(liste), { status: 200 }),
            );
        });
        vi.stubGlobal("fetch", fetchStub);
        const quellen = {
            orte: shallowRef<EditorPlaceList | undefined>(undefined),
            landschaften: shallowRef<EditorLandscapeList | undefined>(undefined),
            kraftlinien: shallowRef<EditorPowerlineList | undefined>(undefined),
            wege: shallowRef<EditorPathList | undefined>(undefined),
            herrschaftsgebiete: shallowRef<EditorTerritoryList | undefined>(undefined),
            sprachen: shallowRef<SpracheEditorListe | undefined>(undefined),
            quellen: shallowRef<InhalteQuellenListe | undefined>(undefined),
            literatur: shallowRef<InhalteWerkListe | undefined>(undefined),
            vorkommen: shallowRef<InhalteVorkommenListe | undefined>(undefined),
            korpora: shallowRef<InhalteKorporaListe | undefined>(undefined),
            wetter: shallowRef<WetterBestand | undefined>(undefined),
        };
        const zahlen = createKarteninhaltZahlen(quellen, undefined, sofort);
        zahlen.gebraucht();
        await vi.waitFor(() => {
            expect(zahlen.zaehlung.value.korpora?.gesamt).toBe(12);
            expect(zahlen.zaehlung.value.quellen?.gesamt).toBe(4184);
            expect(zahlen.zaehlung.value.literatur?.gesamt).toBe(2003);
            expect(zahlen.zaehlung.value.vorkommen?.gesamt).toBe(5138);
        });
        const inhalte = adressen.filter((adresse) => adresse.startsWith("/api/editor/inhalte/"));
        expect([...inhalte].sort()).toEqual([
            "/api/editor/inhalte/korpora?limit=1",
            "/api/editor/inhalte/literatur?limit=1",
            "/api/editor/inhalte/quellen?limit=1",
            "/api/editor/inhalte/vorkommen?limit=1",
        ]);
        zahlen.destroy();
    });
});
