import { describe, expect, it } from "vitest";
import type { InhalteVorkommen } from "@avesmaps3d/shared";
import {
    KEIN_WIKI,
    quelleAlsKlapp,
    quellenNotiz,
    quellenWikiAus,
    wikiAngaben,
    type QuellenWiki,
} from "../src/inhalte/inhalte-vorkommen-klapp.ts";
import {
    aendereQuelle,
    haengeQuelleAn,
    type EntwurfQuelle,
    type VorkommenStand,
} from "../src/inhalte/inhalte-vorkommen-modell.ts";

/**
 * Der Übergang vom Entwurf des Reiters „Vorkommen“ zur Quellen-Klappbox (`fenster/quellen-klappbox.vue`, WI-0254 `--weiter`, §12): was die Box aus einer Quelle des Entwurfs zeigt, und woher der Kreis kommt.
 *
 * 🔴 Herkunft ist der Vergleich mit dem Wiki (Vali: „ist egal, wo er sie her hat, vergleich mit dem wiki, alles andere ist manuell“). Problemfälle: ein Kreis, der eine unterdrückte oder gelöste Quelle als aktiv malt;
 * ein Kreis nach dem Ursprung der Verknüpfung statt nach dem Wiki; ein Kreis, der erst mit dem Speichern folgt statt sofort mit dem Entwurf; ein Kreis ohne Lauf, der „weicht ab“ behauptet; eine eben angehängte
 * Quelle, die „offiziell“ behauptet, bevor der Server es weiß; die Notiz, die roh statt als Text ankommt; „↺ Wiki-Wert“, das die Notiz des Wikis nur halb übernimmt.
 */

const quelle = (n: number, teil: Partial<EntwurfQuelle> = {}): EntwurfQuelle => ({
    sourceId: `00000000-0000-4000-8000-00000000050${String(n)}`,
    title: `Quelle ${String(n)}`,
    sourceType: "regionalspielhilfe",
    offiziell: true,
    url: null,
    referenceKind: null,
    pages: "",
    note: "",
    state: "active",
    ursprung: "wiki",
    herkunft: "legacy",
    neu: false,
    ...teil,
});

const stand = (quellen: readonly EntwurfQuelle[]): VorkommenStand => ({
    felder: {
        name: "Eintrag",
        art: "fauna",
        gruppe: "",
        lebensraum: "",
        synonyme: "",
        editorNote: "",
        aktiv: true,
    },
    orte: [],
    quellen,
    regeln: [],
});

/** Ein Lauf, in dem der Artikel Quelle 1 mit Art, Seite 88 und einer Notiz zitiert. */
const MIT_LAUF: QuellenWiki = {
    lauf: true,
    zitate: new Map([
        [quelle(1).sourceId, { art: "ausfuehrlich", seiten: "88", notiz: "{{R5}} Zoo" }],
        [quelle(2).sourceId, { art: null, seiten: "", notiz: "" }],
    ]),
};
const wieImWiki = (teil: Partial<EntwurfQuelle> = {}): EntwurfQuelle =>
    quelle(1, { referenceKind: "ausfuehrlich", pages: "88", note: "{{R5}} Zoo", ...teil });

describe("Eine Quelle des Eintrags in der Form der Klappbox: der Kreis ist der Vergleich mit dem Wiki", () => {
    it("🔴 ● wie im Wiki, ◐ bei jeder Abweichung oder wenn der Artikel die Quelle nicht zitiert, ○ wenn sie nicht aktiv ist – unabhängig vom Ursprung der Verknüpfung", () => {
        const klapp = [
            wieImWiki(),
            wieImWiki({ pages: "89" }),
            wieImWiki({ referenceKind: "ergaenzend" }),
            wieImWiki({ note: "andere Notiz" }),
            // Nichts im Wiki zitiert diese Quelle (Quelle 3 hat kein Zitat), egal ob Legacy, Wiki oder von Hand.
            quelle(3, { ursprung: "wiki" }),
            quelle(3, { ursprung: "manual" }),
            // Nicht aktiv: ○, gleich was das Wiki sagt.
            wieImWiki({ state: "suppressed" }),
            wieImWiki({ state: "retired", ursprung: "manual" }),
            // Das Wiki zitiert Quelle 2 ohne Angaben, die Verknüpfung hat auch keine: gleich.
            quelle(2),
        ].map((q) => quelleAlsKlapp(q, "", MIT_LAUF));
        expect(klapp.map((k) => k.kreis)).toEqual([
            "voll",
            "halb",
            "halb",
            "halb",
            "halb",
            "halb",
            "leer",
            "leer",
            "voll",
        ]);
    });

    it("🔴 ohne Lauf mit Zitaten fehlt der Kreis einer aktiven Quelle (die Herkunft ist unbekannt), eine nicht aktive ist trotzdem ○", () => {
        const klapp = [quelle(1), quelle(2, { state: "retired" })].map((q) => quelleAlsKlapp(q, ""));
        expect(klapp.map((k) => k.kreis)).toEqual([null, "leer"]);
        // Ohne Lauf gibt es auch kein Zitat an der Zeile.
        expect(klapp[0]).not.toHaveProperty("wiki");
        expect(quelleAlsKlapp(quelle(1), "", KEIN_WIKI)).not.toHaveProperty("wiki");
    });

    it("eine per Link angehängte Quelle trägt den Namen ihres Korpus in die Zeile; ohne Korpus bleibt er leer", () => {
        const start = stand([]);
        const mit = haengeQuelleAn(start, {
            sourceId: "00000000-0000-4000-8000-000000000777",
            title: "Seite",
            korpus: "LieblichesFeld-Wiki",
        });
        expect(quelleAlsKlapp(mit.quellen[0]!, "").korpus).toBe("LieblichesFeld-Wiki");
        const ohne = haengeQuelleAn(start, { sourceId: "00000000-0000-4000-8000-000000000778", title: "Seite" });
        expect(quelleAlsKlapp(ohne.quellen[0]!, "").korpus ?? null).toBeNull();
    });

    it("🔴 der Kreis rechnet mit den Werten des ENTWURFS und folgt sofort: Fundstelle auf die des Wikis ändern macht ●, danach wieder ◐", () => {
        const start = stand([wieImWiki({ pages: "12" })]);
        const id = start.quellen[0]!.sourceId;
        const kreis = (s: VorkommenStand): string | null => quelleAlsKlapp(s.quellen[0]!, "", MIT_LAUF).kreis;
        expect(kreis(start)).toBe("halb");
        const gleich = aendereQuelle(start, id, { pages: "88" });
        expect(kreis(gleich)).toBe("voll");
        expect(kreis(aendereQuelle(gleich, id, { pages: "8" }))).toBe("halb");
    });

    it("🔴 trägt das Zitat des Wikis an die Zeile: mit Lauf das Zitat oder null (nicht zitiert), damit die offene Box „Im Wiki: …“ nennen kann", () => {
        expect(quelleAlsKlapp(wieImWiki({ pages: "12" }), "", MIT_LAUF).wiki).toEqual({
            art: "ausfuehrlich",
            seiten: "88",
            notiz: "{{R5}} Zoo",
        });
        expect(quelleAlsKlapp(quelle(3), "", MIT_LAUF).wiki).toBeNull();
    });

    it("übernimmt Titel, Art, Seiten, Typ, Adresse und Zustand; die Notiz ist die zur Anzeige", () => {
        const q = quelle(1, {
            referenceKind: "ausfuehrlich",
            pages: "88",
            note: "{{R5}} roh",
            url: "https://shop.example/x",
        });
        expect(quelleAlsKlapp(q, "Text statt Vorlage")).toEqual({
            id: q.sourceId,
            titel: "Quelle 1",
            art: "ausfuehrlich",
            seiten: "88",
            notiz: "Text statt Vorlage",
            typ: "regionalspielhilfe",
            offiziell: true,
            url: "https://shop.example/x",
            kreis: null,
            state: "active",
            neu: false,
        });
    });

    it("🔴 eine eben angehängte Quelle ist neu und weicht vom Wiki ab (◐), kennt Typ und Adresse aus der Suche, aber „offiziell“ erst nach dem Speichern", () => {
        const mit = haengeQuelleAn(stand([quelle(1)]), {
            sourceId: "00000000-0000-4000-8000-000000000997",
            title: "Neu",
            sourceType: "roman",
            url: "https://a.example/q",
        });
        expect(quelleAlsKlapp(mit.quellen.at(-1)!, "", MIT_LAUF)).toMatchObject({
            neu: true,
            kreis: "halb",
            typ: "roman",
            url: "https://a.example/q",
            offiziell: null,
        });
    });
});

describe("Der Vergleichsstand aus dem Eintrag des Servers", () => {
    const eintrag = (teil: Partial<Pick<InhalteVorkommen, "quellenWiki">>, wikis: (object | null | undefined)[]) =>
        ({
            quellen: wikis.map((wiki, index) => ({
                ...quelle(index + 1),
                ...(wiki === undefined ? {} : { wiki }),
            })),
            ...teil,
        }) as unknown as Pick<InhalteVorkommen, "quellen" | "quellenWiki">;

    it("🔴 ohne Lauf (kein quellenWiki) ist nichts zu vergleichen, auch wenn eine Quelle ein Zitat trüge", () => {
        expect(quellenWikiAus(eintrag({}, [undefined, { art: "ergaenzend", seiten: "1", notiz: null }]))).toBe(
            KEIN_WIKI,
        );
    });

    it("🔴 mit Lauf steht das Zitat je Quelle da; was der Artikel nicht zitiert (null), hat keines; fehlende Seiten und Notiz sind leer", () => {
        const stand = quellenWikiAus(
            eintrag({ quellenWiki: { laufId: 7, dumpStand: null, beendetAm: null } }, [
                { art: "ergaenzend", seiten: null, notiz: "Text" },
                null,
            ]),
        );
        expect(stand.lauf).toBe(true);
        expect([...stand.zitate]).toEqual([[quelle(1).sourceId, { art: "ergaenzend", seiten: "", notiz: "Text" }]]);
    });
});

describe("„↺ Wiki-Wert“ im Entwurf", () => {
    it("🔴 setzt Art, Fundstelle und Notiz des Zitats (die Notiz roh) – der Kreis wird ●, ohne dass etwas gespeichert ist", () => {
        const start = stand([quelle(1, { referenceKind: "erwaehnung", pages: "1", note: "alt" })]);
        const id = start.quellen[0]!.sourceId;
        const zitat = MIT_LAUF.zitate.get(id)!;
        expect(wikiAngaben(zitat)).toEqual({ referenceKind: "ausfuehrlich", pages: "88", note: "{{R5}} Zoo" });
        const danach = aendereQuelle(start, id, wikiAngaben(zitat));
        expect(danach.quellen[0]).toMatchObject({ referenceKind: "ausfuehrlich", pages: "88", note: "{{R5}} Zoo" });
        expect(quelleAlsKlapp(danach.quellen[0]!, "", MIT_LAUF).kreis).toBe("voll");
    });

    it("ein Zitat ohne Art und Notiz leert die Felder (null, leer)", () => {
        const start = stand([quelle(2, { referenceKind: "erwaehnung", pages: "9", note: "x" })]);
        const id = start.quellen[0]!.sourceId;
        const danach = aendereQuelle(start, id, wikiAngaben(MIT_LAUF.zitate.get(id)!));
        expect(danach.quellen[0]).toMatchObject({ referenceKind: null, pages: "", note: "" });
        expect(quelleAlsKlapp(danach.quellen[0]!, "", MIT_LAUF).kreis).toBe("voll");
    });
});

describe("Die Notiz zur Anzeige", () => {
    it("zeigt den Text, solange der Entwurf den gespeicherten Rohwert hält; wer tippt, sieht genau seinen Text", () => {
        expect(quellenNotiz({ note: "{{R5}} Zoo" }, "{{R5}} Zoo", undefined)).toBe("DSA5-Regeln Zoo");
        expect(quellenNotiz({ note: "{{R5}} eigener Text" }, "{{R5}} Zoo", undefined)).toBe("{{R5}} eigener Text");
        // Eine eben angehängte Quelle hat keinen gespeicherten Stand: Dort steht, was im Entwurf steht.
        expect(quellenNotiz({ note: "getippt" }, undefined, undefined)).toBe("getippt");
    });

    it("🔴 nach „↺ Wiki-Wert“ steht der Text des Zitats im Feld, nicht sein Rohwert", () => {
        const zitat = { art: null, seiten: "", notiz: "{{R5}} Wiki" };
        expect(quellenNotiz({ note: "{{R5}} Wiki" }, "{{R5}} Zoo", zitat)).toBe("DSA5-Regeln Wiki");
        // Ein anderer Text, auch bei vorhandenem Zitat, bleibt, wie getippt.
        expect(quellenNotiz({ note: "anders" }, "{{R5}} Zoo", zitat)).toBe("anders");
    });
});
