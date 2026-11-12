import { describe, expect, it } from "vitest";
import {
    CAPABILITY_NAMES,
    EDITORPANEL,
    capabilitiesFor,
    editorViewer,
    sessionViewer,
    verbModus,
    visitorViewer,
    type NavTafel,
} from "@avesmaps3d/shared";
import type { AuthSnapshot } from "../src/auth/session-state";
import {
    createNavStand,
    navRechte,
    oeffnetBeimLaden,
    offenSchluessel,
    tieferLinkAus,
    type Speicher,
} from "../src/editor-panel/editor-panel-nav";

/**
 * Wo man im Editorpanel steht (WI-0128 E3, EDIT-0001 §7.1 E3): Kaskade nach Neuladen wiederhergestellt, Tiefer Link schlägt
 * Gemerktes, Speicher wirft → Panel funktioniert, Reviewer liest nur, Telefon startet eingeklappt. Die Adresszeile prüft der
 * Browsertest (`editor-panel.spec.ts`).
 */
function tafelSpeicher(): Speicher & { werte: Map<string, string> } {
    const werte = new Map<string, string>();
    return {
        werte,
        getItem: (k) => werte.get(k) ?? null,
        setItem: (k, v) => void werte.set(k, v),
        removeItem: (k) => void werte.delete(k),
    };
}

const werfend: Speicher = {
    getItem: () => {
        throw new Error("gesperrt");
    },
    setItem: () => {
        throw new Error("gesperrt");
    },
    removeItem: () => {
        throw new Error("gesperrt");
    },
};

const editor = [...capabilitiesFor("editor")];
const reviewer = [...capabilitiesFor("reviewer")];

/** Eine Tafel mit zwei wählbaren Reitern, damit Gemerktes und Tiefer Link auseinanderfallen können. */
const probe: NavTafel = {
    id: "probe",
    wurzel: "reiter",
    eintraege: [
        { id: "eins", unter: null, art: "bereich", rechte: ["use_editor_menu"], kinder: "schiene" },
        {
            id: "eins-a",
            unter: "eins",
            art: "subjekt",
            rechte: [],
            liste: "flach",
            ziel: "punkt",
            verb: { id: "va", werkzeug: "wa", rechte: [] },
        },
        { id: "wa", unter: "eins-a", art: "werkzeug", rechte: [] },
        {
            id: "zwei",
            unter: null,
            art: "bereich",
            rechte: ["use_editor_menu"],
            kinder: "schiene",
            alias: ["alt-zwei"],
        },
        {
            id: "zwei-a",
            unter: "zwei",
            art: "subjekt",
            rechte: [],
            liste: "flach",
            ziel: "punkt",
            verb: { id: "vb", werkzeug: "wb", rechte: [] },
        },
        { id: "wb", unter: "zwei-a", art: "werkzeug", rechte: [] },
    ],
};

describe("Tiefer Link aus der Adresse (nur gelesen)", () => {
    it("`?tab=` zuerst, sonst Legacys `reviewTab` und `wikiSyncTab`", () => {
        expect(tieferLinkAus("?tab=orte")).toBe("orte");
        expect(tieferLinkAus("?reviewTab=wiki-sync")).toBe("wiki-sync");
        expect(tieferLinkAus("?wikiSyncTab=locations&tab=karteninhalte")).toBe("karteninhalte");
        expect(tieferLinkAus("?edit=1")).toBeUndefined();
    });
});

describe("der Stand des Editorpanels (EDITORPANEL)", () => {
    it("ohne Gemerktes und ohne Link: Karteninhalte › Orte, die späteren Reiter davor zählen nicht", () => {
        const stand = createNavStand({ tafel: EDITORPANEL, rechte: editor, search: "", speicher: tafelSpeicher() });
        expect(stand.pfad.value).toEqual(["karteninhalte", "orte"]);
        expect(stand.gewaehlt(null)).toBe("karteninhalte");
        expect(stand.gewaehlt("karteninhalte")).toBe("orte");
        expect(stand.ausLink).toBe(false);
        expect(stand.gemerktOffen).toBeUndefined();
    });

    it("🔴 ein späterer Eintrag lässt sich nicht wählen und wird nicht gemerkt", () => {
        // „Literatur“ ist seit WI-0254 gebaut (Fenster „Inhalte bearbeiten“), „Community“ seit WI-0268 C3; „Karten“ ist noch „später“; der Unterreiter „Mails“ (seit WI-0268 C4) braucht `read_mailbox`, das ein Editor nicht hat, und lässt sich darum nicht wählen.
        const speicher = tafelSpeicher();
        const stand = createNavStand({ tafel: EDITORPANEL, rechte: editor, search: "", speicher });
        stand.waehle("karten");
        stand.waehle("mails");
        expect(stand.pfad.value).toEqual(["karteninhalte", "orte"]);
        expect([...speicher.werte.values()]).not.toContain("karten");
    });

    it("Legacys Alias öffnet dieselbe Stelle und das Panel", () => {
        const stand = createNavStand({
            tafel: EDITORPANEL,
            rechte: editor,
            search: "?reviewTab=wiki-sync",
            speicher: tafelSpeicher(),
        });
        expect(stand.ausLink).toBe(true);
        expect(stand.gewaehlt(null)).toBe("karteninhalte");
    });

    it("🔴 Community › Meldungen: Tiefer Link `?tab=meldungen`, Legacys `reports` und `review`, gemerkt wie die übrigen Reiter (WI-0268 C3)", () => {
        for (const [search, pfad] of [
            ["?tab=meldungen", ["community", "meldungen"]],
            ["?tab=reports", ["community", "meldungen"]],
            // `review` ist der alte Name des Reiters; darunter steht der erste wählbare Unterreiter.
            ["?reviewTab=review", ["community", "meldungen"]],
        ] as const) {
            const stand = createNavStand({ tafel: EDITORPANEL, rechte: editor, search, speicher: tafelSpeicher() });
            expect(stand.ausLink, search).toBe(true);
            expect(stand.pfad.value, search).toEqual(pfad);
        }
        // Die Wahl des Reiters wird gemerkt, der Unterreiter darunter auch; `mails` braucht `read_mailbox` (ab Betreiber) und lässt sich ohne das Recht nicht wählen.
        const speicher = tafelSpeicher();
        const stand = createNavStand({ tafel: EDITORPANEL, rechte: editor, search: "", speicher });
        stand.waehle("community");
        expect(stand.pfad.value).toEqual(["community", "meldungen"]);
        stand.waehle("mails");
        expect(stand.pfad.value).toEqual(["community", "meldungen"]);
        const neu = createNavStand({ tafel: EDITORPANEL, rechte: editor, search: "", speicher });
        expect(neu.pfad.value).toEqual(["community", "meldungen"]);
        expect([...speicher.werte.values()]).not.toContain("mails");
    });

    it('🔴 der Klick in der Glocke wählt mit `waehle("meldungen")` aus jedem Stand Community › Meldungen (WI-0268 C5)', () => {
        const stand = createNavStand({ tafel: EDITORPANEL, rechte: editor, search: "", speicher: tafelSpeicher() });
        expect(stand.pfad.value).toEqual(["karteninhalte", "orte"]);
        stand.waehle("meldungen");
        expect(stand.pfad.value).toEqual(["community", "meldungen"]);
        // Wer ohne das Recht dasteht, bleibt, wo er ist.
        const ohne = createNavStand({ tafel: EDITORPANEL, rechte: [], search: "", speicher: tafelSpeicher() });
        const vorher = ohne.pfad.value;
        ohne.waehle("meldungen");
        expect(ohne.pfad.value).toEqual(vorher);
    });

    it("ein unbekannter oder gesperrter Link öffnet nichts", () => {
        const fremd = createNavStand({
            tafel: EDITORPANEL,
            rechte: editor,
            search: "?tab=gibts",
            speicher: tafelSpeicher(),
        });
        expect(fremd.ausLink).toBe(false);
        const spaeter = createNavStand({
            tafel: EDITORPANEL,
            rechte: editor,
            search: "?tab=karten",
            speicher: tafelSpeicher(),
        });
        expect(spaeter.ausLink).toBe(false);
    });
});

describe("🔴 Merken (Legacy `REVIEW_TAB_FAMILIES`)", () => {
    it("die Kaskade steht nach dem Neuladen wieder da", () => {
        const speicher = tafelSpeicher();
        createNavStand({ tafel: probe, rechte: editor, search: "", speicher }).waehle("zwei-a");
        const nachher = createNavStand({ tafel: probe, rechte: editor, search: "", speicher });
        expect(nachher.pfad.value).toEqual(["zwei", "zwei-a"]);
        expect(speicher.werte.get("avesmaps3d.nav.probe.wurzel")).toBe("zwei");
        expect(speicher.werte.get("avesmaps3d.nav.probe.zwei")).toBe("zwei-a");
    });

    it("🔴 ein Tiefer Link schlägt das Gemerkte", () => {
        const speicher = tafelSpeicher();
        createNavStand({ tafel: probe, rechte: editor, search: "", speicher }).waehle("zwei-a");
        const mitLink = createNavStand({ tafel: probe, rechte: editor, search: "?tab=eins", speicher });
        expect(mitLink.pfad.value).toEqual(["eins", "eins-a"]);
        expect(mitLink.ausLink).toBe(true);
    });

    it("ein Reiterwechsel holt die gemerkte Wahl darunter zurück", () => {
        const speicher = tafelSpeicher();
        const stand = createNavStand({ tafel: probe, rechte: editor, search: "", speicher });
        stand.waehle("zwei-a");
        stand.waehle("eins");
        stand.waehle("zwei");
        expect(stand.pfad.value).toEqual(["zwei", "zwei-a"]);
    });

    it("ein Wert, der nicht mehr gilt, wird gelöscht", () => {
        const speicher = tafelSpeicher();
        speicher.werte.set("avesmaps3d.nav.editorpanel.karteninhalte", "karten");
        createNavStand({ tafel: EDITORPANEL, rechte: editor, search: "", speicher });
        expect(speicher.werte.has("avesmaps3d.nav.editorpanel.karteninhalte")).toBe(false);
    });

    it("ob das Panel offen war, steht unter einem eigenen Schlüssel", () => {
        const speicher = tafelSpeicher();
        createNavStand({ tafel: EDITORPANEL, rechte: editor, search: "", speicher }).merkeOffen(true);
        expect(speicher.werte.get(offenSchluessel(EDITORPANEL))).toBe("offen");
        expect(createNavStand({ tafel: EDITORPANEL, rechte: editor, search: "", speicher }).gemerktOffen).toBe(true);
    });

    it("🔴 wirft der Speicher, geht alles weiter: Wahl bis zum Neuladen, nichts gemerkt", () => {
        const stand = createNavStand({ tafel: probe, rechte: editor, search: "", speicher: werfend });
        expect(stand.pfad.value).toEqual(["eins", "eins-a"]);
        stand.waehle("zwei-a");
        expect(stand.pfad.value).toEqual(["zwei", "zwei-a"]);
        expect(() => stand.merkeOffen(true)).not.toThrow();
        expect(stand.gemerktOffen).toBeUndefined();
        const ohne = createNavStand({ tafel: probe, rechte: editor, search: "", speicher: undefined });
        expect(ohne.pfad.value).toEqual(["eins", "eins-a"]);
    });
});

describe("beim Laden offen oder zu", () => {
    it("🔴 am Telefon startet es eingeklappt, auch mit Link und Gemerktem", () => {
        expect(oeffnetBeimLaden({ ausLink: true, gemerktOffen: true }, true)).toBe(false);
    });

    it("🔴 am Rechner steht es offen, solange es niemand zugeklappt hat (Betreiber 2026-10-14)", () => {
        // Der Fall, um den es geht: erste Anmeldung, nichts gemerkt, kein Tiefer Link.
        expect(oeffnetBeimLaden({ ausLink: false, gemerktOffen: undefined }, false)).toBe(true);
        expect(oeffnetBeimLaden({ ausLink: false, gemerktOffen: true }, false)).toBe(true);
        expect(oeffnetBeimLaden({ ausLink: true, gemerktOffen: false }, false)).toBe(true);
        // Nur das eigene Zuklappen hält es zu - und ein Tiefer Link hebt auch das auf (Zeile darüber).
        expect(oeffnetBeimLaden({ ausLink: false, gemerktOffen: false }, false)).toBe(false);
    });
});

describe("die Rechte der Ansicht", () => {
    const angemeldet = (capabilities: readonly string[]): AuthSnapshot => ({
        known: true,
        authEnabled: true,
        environment: "local",
        person: null,
        capabilities,
    });
    const ohneAnmeldung: AuthSnapshot = {
        known: false,
        authEnabled: false,
        environment: null,
        person: null,
        capabilities: [],
    };

    it("ohne Editor-Menü (Besucher, `?besucher`) gibt es keine", () => {
        expect(navRechte(visitorViewer("test"), angemeldet(editor))).toEqual([]);
    });

    it("mit Anmeldung die der Sitzung, ohne sie der ganze Katalog", () => {
        expect(navRechte(sessionViewer("test", reviewer), angemeldet(reviewer))).toEqual(reviewer);
        expect(navRechte(editorViewer("test"), ohneAnmeldung)).toEqual(CAPABILITY_NAMES);
    });

    it("🔴 ein Reviewer sieht das Verb und öffnet nur lesend, ein Editor bearbeitet", () => {
        const rechteReviewer = navRechte(sessionViewer("test", reviewer), angemeldet(reviewer));
        expect(verbModus(EDITORPANEL, "orte", rechteReviewer)).toBe("lesen");
        const rechteEditor = navRechte(sessionViewer("test", editor), angemeldet(editor));
        expect(verbModus(EDITORPANEL, "orte", rechteEditor)).toBe("bearbeiten");
    });
});
