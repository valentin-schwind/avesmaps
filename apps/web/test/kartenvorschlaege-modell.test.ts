import { describe, expect, it } from "vitest";
import { KARTENVORSCHLAG_ZUSTAENDE, type KartenvorschlagDetail, type SearchHit } from "@avesmaps3d/shared";
import { ApiFailure } from "../src/auth/api";
import { satzTeile } from "../src/auth/benachrichtigungen";
import { schrittFehler } from "../src/community/kartenvorschlaege-api";
import {
    ZUSTAND_NAME,
    dateiName,
    eingangSatz,
    faktenVon,
    folgenVon,
    fussVon,
    hinweisVon,
    istOffen,
    kreisVon,
    legendeNamen,
    legendeZahlen,
    orteAusTreffern,
    quelleVon,
    technikName,
    verlaufVon,
    zustandSatz,
} from "../src/community/kartenvorschlaege-modell";
import { da } from "../src/i18n/da";
import { de } from "../src/i18n/de";
import { en } from "../src/i18n/en";
import { es } from "../src/i18n/es";
import { fr } from "../src/i18n/fr";
import { t } from "../src/i18n/i18n";
import { it as itTafel } from "../src/i18n/it";
import { nl } from "../src/i18n/nl";
import { pl } from "../src/i18n/pl";
import { sv } from "../src/i18n/sv";

/**
 * Die Redaktion der Kartenvorschläge ohne Browser (WI-0275): was Liste und Fenster rechnen. Das Zusammenspiel prüft `e2e/kartenvorschlag-redaktion.spec.ts`, den Server `apps/server/test/kartenvorschlag-annehmen.test.ts`.
 */

const tafeln = { de, en, da, es, fr, it: itTafel, nl, pl, sv } as const satisfies Record<
    string,
    Record<string, string>
>;

const ID = "00000000-0000-4000-8000-000000000001";

const vorschlag = (patch: Partial<KartenvorschlagDetail> = {}): KartenvorschlagDetail => ({
    id: ID,
    nummer: "K-1047",
    zustand: "pending",
    weg: "datei",
    titel: "Gareth, Gesamtplan",
    link: null,
    dateiTyp: "image/jpeg",
    ort: { id: ID, name: "Gareth" },
    eingegangenAm: "2026-11-01T10:00:00.000Z",
    technik: "ok",
    revision: 1,
    beschreibung: null,
    quelle: null,
    nutzung: "cc-by-4.0",
    name: null,
    typen: [],
    urheber: null,
    art: null,
    gueltigAb: null,
    gueltigBis: null,
    farbe: null,
    spoiler: null,
    beschriftet: null,
    mehrstoeckig: null,
    offiziell: null,
    kostenpflichtig: null,
    vorschauLink: null,
    notiz: null,
    asset: ID,
    entschiedenAm: null,
    grund: null,
    karte: null,
    ortArt: null,
    ortLage: null,
    vorschau: null,
    ...patch,
});
const linkVorschlag = (patch: Partial<KartenvorschlagDetail> = {}): KartenvorschlagDetail =>
    vorschlag({
        weg: "link",
        link: "https://www.kartenfreunde.example/havena",
        dateiTyp: null,
        nutzung: null,
        asset: null,
        technik: null,
        ...patch,
    });

describe("Zustand in Kreis und Worten", () => {
    it("jeder Zustand hat seinen Kreis und seinen Namen; offen sind die drei vor der Entscheidung", () => {
        expect(KARTENVORSCHLAG_ZUSTAENDE.map(kreisVon)).toEqual([
            "halb",
            "halb-rechts",
            "leer",
            "voll",
            "gestrichelt",
            "gestrichelt",
        ]);
        for (const zustand of KARTENVORSCHLAG_ZUSTAENDE) expect(t(ZUSTAND_NAME[zustand])).not.toBe("");
        expect(KARTENVORSCHLAG_ZUSTAENDE.filter(istOffen)).toEqual(["incoming", "technical_failed", "pending"]);
    });

    it("„incoming“ trennt: noch keine Datei oder noch in der Prüfung, und nennt bei einer defekten den Grund", () => {
        expect(hinweisVon(vorschlag({ zustand: "incoming", technik: null }))).toBe("Datei noch nicht angekommen");
        expect(hinweisVon(vorschlag({ zustand: "incoming", technik: "pending" }))).toBe("Datei wird noch geprüft");
        expect(hinweisVon(vorschlag({ zustand: "technical_failed", technik: "decode_failed" }))).toBe(
            "Datei defekt: beschädigt oder verschlüsselt",
        );
        expect(technikName("etwas_neues"), "ein unbekannter Befund").toBe("nicht lesbar");
        expect(hinweisVon(vorschlag()), "wer wartet, braucht keinen Hinweis").toBeUndefined();
        expect(zustandSatz(vorschlag({ zustand: "incoming", technik: null }))).toBe("Datei noch nicht angekommen");
        expect(zustandSatz(vorschlag({ zustand: "incoming", technik: "pending" }))).toBe("Datei wird geprüft");
    });

    it("die Quelle: der Host eines Links ohne www, das Format einer Datei", () => {
        expect(quelleVon(linkVorschlag())).toBe("kartenfreunde.example");
        expect(quelleVon(vorschlag())).toBe("JPEG-Bild");
        expect(dateiName("application/pdf")).toBe("PDF-Datei");
        expect(eingangSatz(vorschlag(), new Date("2026-11-04T10:00:00.000Z"))).toMatch(/^Eigene Datei, eingegangen /);
    });

    it("die Legende nennt je Segment seine Zustände; abgelehnt und zurückgezogen teilen sich den Ring und die Zahl", () => {
        const zaehler = { incoming: 1, technical_failed: 2, pending: 3, approved: 4, rejected: 5, withdrawn: 6 };
        expect(legendeNamen("offen")).toEqual({ leer: "wartet", halb: "wird geprüft", "halb-rechts": "Datei defekt" });
        expect(Object.keys(legendeNamen("angenommen"))).toEqual(["voll"]);
        expect(Object.keys(legendeNamen("abgelehnt"))).toEqual(["gestrichelt"]);
        expect(legendeZahlen(zaehler)).toEqual({ leer: 3, halb: 1, "halb-rechts": 2, voll: 4, gestrichelt: 11 });
    });
});

describe("Der Fuß", () => {
    it("Annehmen sperrt mit einem Satz, solange die Datei fehlt, geprüft wird oder defekt ist; wer wartet, kann angenommen werden", () => {
        expect(fussVon(vorschlag()).sperre).toBeUndefined();
        expect(fussVon(linkVorschlag()).satz).toBe("Annehmen legt die Karte mit diesem Link in der Sammlung an.");
        expect(fussVon(vorschlag({ zustand: "incoming", technik: null })).sperre).toBe(
            "Die Datei ist noch nicht angekommen.",
        );
        expect(fussVon(vorschlag({ zustand: "incoming", technik: "pending" })).sperre).toBe(
            "Die Datei wird noch geprüft.",
        );
        expect(fussVon(vorschlag({ zustand: "technical_failed", technik: "decode_failed" })).sperre).toBe(
            "Die Datei ließ sich nicht lesen.",
        );
    });
});

describe("Die Angaben", () => {
    it("🔴 unbekannt ist nicht „nein“: was fehlt, steht unter Unbekannt, ein ausdrückliches Nein als Zeile", () => {
        const { zeilen, fehlt } = faktenVon(vorschlag({ spoiler: false, kostenpflichtig: true, art: "politisch" }));
        expect(zeilen.find((zeile) => zeile.name === "Spoiler")).toEqual({ name: "Spoiler", wert: "nein" });
        expect(zeilen.find((zeile) => zeile.name === "Kostenpflichtig")).toMatchObject({ wert: "ja", achtung: true });
        expect(fehlt).toContain("Offiziell");
        expect(fehlt).not.toContain("Spoiler");
    });

    it("der Zeitraum: beide, nur der Anfang, nur das Ende", () => {
        const wert = (patch: Partial<KartenvorschlagDetail>) =>
            faktenVon(vorschlag(patch)).zeilen.find((zeile) => zeile.name === "Zeitraum")?.wert;
        expect(wert({ gueltigAb: 1035, gueltigBis: 1040 })).toBe("1035 bis 1040 BF");
        expect(wert({ gueltigAb: 1035 })).toBe("seit 1035 BF");
        expect(wert({ gueltigBis: 1040 })).toBe("bis 1040 BF");
        expect(wert({})).toBeUndefined();
    });
});

describe("Was eine Annahme tut", () => {
    it("ein Link: sofort öffentlich, die Quelle beschriftet ihn, ohne Satz zum Original", () => {
        const folgen = folgenVon(linkVorschlag({ quelle: "Bote 123", beschreibung: "Ein Plan", art: "politisch" }));
        expect(folgen.uebernommen).toBe(
            "Titel, Art; Beschreibung als Notiz der Karte; Link mit der Quelle als Beschriftung",
        );
        expect(folgen.oeffentlich).toBe("Sofort, mit diesem Link.");
        expect(folgen.original).toBeUndefined();
    });

    it("eine Datei: Vollkarte, die Quelle in der Notiz; was der Redaktion gehört, geht nicht über; beim PDF bleibt nur Seite 1", () => {
        const folgen = folgenVon(vorschlag({ quelle: "Bote 123", notiz: "Hallo", name: "Alrik", spoiler: false }));
        expect(folgen.uebernommen).toBe("Titel, Merkmale; Quelle am Ende der Notiz; Datei als Vollkarte");
        expect(folgen.nicht).toBe("Notiz an die Redaktion, Name des Einreichers");
        expect(folgen.original).toBe("Wird rund eine Woche nach der Annahme gelöscht.");
        expect(folgenVon(vorschlag({ dateiTyp: "application/pdf" })).original).toContain(
            "Beim PDF bleibt nur Seite 1.",
        );
        expect(folgenVon(vorschlag()).nicht).toBeUndefined();
    });
});

describe("Der Verlauf", () => {
    const jetzt = new Date("2026-11-04T10:00:00.000Z");
    it("Eingang und Entscheidung; ein Grund steht im Satz, ein Zurückziehen hat keine Zeit", () => {
        expect(verlaufVon(linkVorschlag(), jetzt).map((zeile) => zeile.text)).toEqual(["eingegangen (Link)"]);
        expect(
            verlaufVon(
                vorschlag({ zustand: "rejected", grund: "Gibt es schon", entschiedenAm: jetzt.toISOString() }),
                jetzt,
            )[1]?.text,
        ).toBe("abgelehnt: „Gibt es schon“");
        expect(verlaufVon(vorschlag({ zustand: "rejected" }), jetzt)[1]?.text).toBe("abgelehnt, ohne Grund");
        const zurueck = verlaufVon(vorschlag({ zustand: "withdrawn" }), jetzt)[1];
        expect(zurueck?.text).toBe("vom Einreicher zurückgezogen");
        expect(zurueck?.zeit).toBeUndefined();
    });
});

describe("Der Ort aus der Suche", () => {
    const treffer = (patch: Partial<SearchHit>): SearchHit => ({
        kind: "ort",
        id: ID,
        name: "Gareth",
        x: 1,
        y: 2,
        zoom: 3,
        ...patch,
    });
    it("nur Orte mit öffentlicher Kennung, höchstens fünf", () => {
        const orte = orteAusTreffern(
            [
                treffer({}),
                treffer({ kind: "weg", id: "name:Reichsstraße", name: "Reichsstraße" }),
                treffer({ id: "kein-uuid", name: "Ohne Kennung" }),
            ],
            () => "Stadt",
        );
        expect(orte).toEqual([{ id: ID, name: "Gareth", typ: "Stadt" }]);
        expect(
            orteAusTreffern(
                Array.from({ length: 9 }, () => treffer({})),
                () => "",
            ),
        ).toHaveLength(5);
    });
});

describe("Fehler eines Schritts", () => {
    const fehler = (status: number, code: string) => new ApiFailure(status, code, "Text des Servers");
    it("der Fachcode wählt den Satz, nie der Text des Servers", () => {
        expect(schrittFehler(fehler(409, "kartenvorschlag_conflict"))).toBe("konflikt");
        expect(schrittFehler(fehler(409, "kartenvorschlag_transition"))).toBe("uebergang");
        expect(schrittFehler(fehler(404, "kartenvorschlag_not_found"))).toBe("uebergang");
        expect(schrittFehler(fehler(422, "kartenvorschlag_invalid"))).toBe("ort");
        // WI-0287 Stufe 2: Der Eintrag, zu dem die Version gehören soll, ist stillgelegt oder fort.
        expect(schrittFehler(fehler(409, "citymap_target_retired"))).toBe("ziel");
        expect(schrittFehler(fehler(404, "not_found"))).toBe("ziel");
        expect(schrittFehler(fehler(503, "map_import_running"))).toBe("import");
        expect(schrittFehler(fehler(423, "map_locked"))).toBe("gesperrt");
        expect(schrittFehler(fehler(0, "network"))).toBe("netz");
        expect(schrittFehler(new Error("anders"))).toBe("sonst");
    });
});

describe("Die Glocke", () => {
    const eintrag = (text: string | null) =>
        ({
            id: 30,
            art: "kartenvorschlag_neu",
            von: { art: "system", id: null, name: null },
            ops: null,
            text,
            frageGeloest: false,
            erstelltAt: "2026-11-04T10:00:00.000Z",
            gelesenAt: null,
            beantwortetAt: null,
            antwort: null,
            vorgang: null,
        }) as const;

    it("🔴 einer nennt seine Kennung und führt zu ihm, mehrere führen in die Liste; ein anderer Text wird nie zum Ziel", () => {
        expect(satzTeile(eintrag(ID)).com).toEqual({ text: "Neuer Kartenvorschlag zum Prüfen", nummer: ID });
        expect(satzTeile(eintrag("3")).com).toEqual({ text: "3 neue Kartenvorschläge zum Prüfen", nummer: null });
        expect(satzTeile(eintrag("Gareth, Gesamtplan")).com?.nummer).toBeNull();
    });

    it("jede Sprachtafel kennt den Satz, die Zahl, die Kategorie „Karte“ der Meldungen (WI-0305) und den kurzen Namen", () => {
        for (const [sprache, tafel] of Object.entries(tafeln) as [string, Record<string, string>][]) {
            expect(tafel["notify.text.kartenvorschlag_neu"], sprache).toBeTruthy();
            expect(tafel["notify.text.kartenvorschlag_neu"], sprache).not.toContain("{");
            expect(tafel["notify.text.kartenvorschlag_neuViele.other"], sprache).toContain("{n}");
            expect(tafel["community.kategorie.karte"], sprache).toBeTruthy();
            expect(tafel["community.redaktion.kartenWeitere"], sprache).toBeTruthy();
            // Der Unterreiter „Karten“ ist fort (WI-0305): seine Namen auch.
            expect(tafel["nav.editorpanel.kartenvorschlaegeKurz"], sprache).toBeUndefined();
            expect(tafel["nav.editorpanel.kartenvorschlaege"], sprache).toBeUndefined();
            expect(tafel["nav.editorpanel.socialKurz"], sprache).toBe("Social");
        }
    });
});
