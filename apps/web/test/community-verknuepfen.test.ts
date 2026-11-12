import { Value } from "@sinclair/typebox/value";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shallowRef } from "vue";
import {
    AnKanalBody,
    KANAL_KATEGORIEN,
    KANAL_PRIORITAETEN,
    capabilitiesFor,
    type VorgangKorrektur,
    type VorgangZeile,
} from "@avesmaps3d/shared";
import type { FensterStand } from "../src/editor-panel/fenster-verwaltung";
import { createWerkzeugfenster } from "../src/editor-panel/werkzeugfenster";
import { beendeHerkunft, herkunftFuer, installiereHerkunft, setzeHerkunft } from "../src/community/herkunft";
import { createRedaktion, type VorgangBezug } from "../src/community/redaktion";
import {
    kennung,
    kennungFrei,
    ladeKorrekturKandidaten,
    reicheAnKanalWeiter,
    verknuepfeKorrektur,
} from "../src/community/redaktion-api";
import {
    KANAL_TITEL_MAX,
    darfInAenderungen,
    darfInKanal,
    kandidatenKopf,
    kandidatenLeer,
    kanalBody,
    kanalFehlerSatz,
    kanalHatEntwurf,
    kanalKategorien,
    kanalKategorieFuer,
    kanalPrioritaeten,
    kanalSperre,
    kanalTitel,
    korrekturFehlerSatz,
    korrekturSperre,
    korrekturZeile,
    neuerKanalEntwurf,
} from "../src/community/verknuepfen-modell";
import { da } from "../src/i18n/da";
import { de } from "../src/i18n/de";
import { en } from "../src/i18n/en";
import { es } from "../src/i18n/es";
import { fr } from "../src/i18n/fr";
import { isMessageKey, setLocale, t } from "../src/i18n/i18n";
import { it as itTafel } from "../src/i18n/it";
import { nl } from "../src/i18n/nl";
import { pl } from "../src/i18n/pl";
import { sv } from "../src/i18n/sv";

/**
 * Verknüpfungen im Vorgangsfenster ohne Browser (WI-0268 C7; Fachkonzept WI-0263 §6 und §7): die Zeilen des Kastens „Korrektur“, die Wahl im Blatt „Korrektur verknüpfen“, der Entwurf des Blatts „An den
 * Betreiber-Kanal weiterreichen“ (🔴 ohne Melderdaten), die Aufrufe an der Leitung und der Weg der COM-Nummer von ⚙ bis zur Kopfzeile der Herkunft.
 */

afterEach(() => {
    setLocale("de");
    beendeHerkunft();
});

const JETZT = new Date("2026-10-31T12:00:00.000Z");
const OPERATION = "a2680c08-0000-4000-9000-000000000001";

const korrektur = (teil: Partial<VorgangKorrektur> = {}): VorgangKorrektur => ({
    operationId: OPERATION,
    aktion: "place.move",
    zusammenfassung: "Gratenfels verschoben, 4 Wegenden mit",
    at: "2026-10-31T10:00:00.000Z",
    von: { id: "p1", name: "Olaf" },
    weg: "editor",
    ...teil,
});

const meldung = (teil: Partial<VorgangZeile> = {}): VorgangZeile => ({
    nummer: "COM-000123",
    art: "meldung",
    kategorie: "lage",
    zustand: "neu",
    ergebnis: null,
    prioritaet: "hoch",
    eingang: "website",
    bezugName: "Wehrheim",
    bezugArt: "objekt",
    zustaendig: null,
    ohneQuelle: false,
    moeglicheDublette: null,
    eingegangenAt: "2026-10-31T10:00:00.000Z",
    aktivAt: "2026-10-31T10:00:00.000Z",
    revision: 1,
    ...teil,
});

describe("Kasten „Korrektur“: eine Zeile je Änderung", () => {
    it("Name der Operation, Satz, Zeit und Person, Weg aus dem Editor", () => {
        const zeile = korrekturZeile(korrektur(), JETZT);
        expect(zeile).toEqual({
            operationId: OPERATION,
            titel: "Verschoben",
            satz: "Gratenfels verschoben, 4 Wegenden mit",
            wann: "vor 2 Std. · Olaf",
            weg: "aus dem Editor",
        });
        expect(korrekturZeile(korrektur({ weg: "hand" }), JETZT).weg).toBe("von Hand verknüpft");
    });

    it("ohne Satz, ohne Person (Agent, Import, System) und ohne Weg (in der Wahl des Blatts) bleibt nur, was da ist", () => {
        const ohne = korrekturZeile(korrektur({ zusammenfassung: null, von: null }), JETZT);
        expect(ohne.satz).toBeUndefined();
        expect(ohne.wann).toBe("vor 2 Std.");
        expect(korrekturZeile(korrektur({ zusammenfassung: "  " }), JETZT).satz).toBeUndefined();
        const wahl = korrekturZeile({ ...korrektur(), weg: undefined }, JETZT);
        expect(wahl.weg).toBeUndefined();
        // Eine unbekannte Art heißt „Änderung“ und nie wie ihr Schlüssel.
        expect(korrekturZeile(korrektur({ aktion: "erfunden.unbekannt" }), JETZT).titel).not.toContain("erfunden");
    });

    it("in einer anderen Sprache folgt der Weg der Sprachtafel", () => {
        setLocale("en");
        expect(korrekturZeile(korrektur(), JETZT).weg).toBe("from the editor");
    });

    it("🔴 der Verweis führt nur dorthin, wo die Sitzung auch hinkommt: Editorpanel und Kanal", () => {
        const reviewer = [...capabilitiesFor("reviewer")];
        const operator = [...capabilitiesFor("operator")];
        expect(darfInAenderungen(reviewer, true)).toBe(true);
        expect(darfInAenderungen(reviewer, false)).toBe(false);
        expect(darfInAenderungen([], true)).toBe(false);
        expect(darfInKanal(operator)).toBe(true);
        expect(darfInKanal(reviewer)).toBe(false);
        expect(darfInKanal([...capabilitiesFor("admin")])).toBe(false);
    });
});

describe("Blatt „Korrektur verknüpfen“", () => {
    it("der Kopf und der Leer-Satz hängen daran, woher die Wahl kommt", () => {
        expect(kandidatenKopf("objekt")).not.toBe(kandidatenKopf("sitzung"));
        expect(kandidatenLeer("objekt")).not.toBe(kandidatenLeer("sitzung"));
        for (const key of [
            kandidatenKopf("objekt"),
            kandidatenKopf("sitzung"),
            kandidatenLeer("objekt"),
            kandidatenLeer("sitzung"),
        ])
            expect(isMessageKey(key), key).toBe(true);
        expect(t(kandidatenLeer("objekt"))).toContain("Objekt");
        expect(t(kandidatenLeer("sitzung"))).toContain("eigene");
    });

    it("🔴 „Verknüpfen“ ist gesperrt, bis eine Änderung gewählt ist, mit einem Satz", () => {
        const sperre = korrekturSperre(undefined);
        expect(sperre).toBeDefined();
        expect(t(sperre!)).toBe("Eine Änderung ist noch nicht gewählt.");
        expect(korrekturSperre(OPERATION)).toBeUndefined();
    });

    it("ein 404 heißt hier, dass es die Änderung nicht gibt; die übrigen Sätze bleiben", () => {
        expect(t(korrekturFehlerSatz("community.redaktion.fehler.nichtGefunden"))).toBe(
            "Diese Änderung gibt es nicht (mehr).",
        );
        expect(korrekturFehlerSatz("community.redaktion.fehler.konflikt")).toBe("community.redaktion.fehler.konflikt");
    });
});

describe("Blatt „An den Betreiber-Kanal weiterreichen“", () => {
    it("vorbelegt: Titel „COM-… · Kategorie · Bezug“, Kategorie des Kanals, Priorität des Vorgangs, Nachricht mit Nummer und Bezug", () => {
        const entwurf = neuerKanalEntwurf(meldung());
        expect(entwurf).toEqual({
            kategorie: "karteninhalt",
            prioritaet: "hoch",
            titel: "COM-000123 · Lage falsch · Wehrheim",
            nachricht: "Aus Community-Vorgang COM-000123.\nBezug: Wehrheim.",
        });
        const stelle = neuerKanalEntwurf(meldung({ kategorie: "fehlt", bezugArt: "stelle", bezugName: "Gallys" }));
        expect(stelle.titel).toBe("COM-000123 · Etwas fehlt · Stelle bei Gallys");
        expect(stelle.nachricht).toContain("Bezug: Stelle bei Gallys.");
    });

    it("🔴 keine Melderdaten: Name, Adresse, Betreff und Text des Melders kommen im Entwurf nie vor", () => {
        const anfrage: VorgangZeile = meldung({
            nummer: "COM-000124",
            art: "anfrage",
            kategorie: "frage",
            prioritaet: "normal",
            bezugArt: null,
            bezugName: null,
            absender: "Alrike Quellenfinder",
            betreff: "Darf die Karte für ein Spielleiterhandbuch gedruckt werden?",
        });
        const entwurf = neuerKanalEntwurf(anfrage);
        expect(entwurf).toEqual({
            kategorie: "nutzerfrage",
            prioritaet: "normal",
            titel: "COM-000124 · Frage",
            nachricht: "Aus Community-Vorgang COM-000124.",
        });
        const alles = JSON.stringify(entwurf);
        for (const verboten of ["Alrike", "Quellenfinder", "Spielleiter", "gedruckt"])
            expect(alles).not.toContain(verboten);
        // Auch eine Meldung mit Absender trägt ihn nicht in den Titel.
        const mitAbsender: VorgangZeile = { ...meldung(), absender: "Alrike" };
        expect(JSON.stringify(neuerKanalEntwurf(mitAbsender))).not.toContain("Alrike");
    });

    it("die Kategorie des Kanals passt zur Art, und jede, die der Server kennt, steht zur Wahl", () => {
        expect(kanalKategorieFuer("meldung")).toBe("karteninhalt");
        expect(kanalKategorieFuer("anfrage")).toBe("nutzerfrage");
        expect(kanalKategorien().map((k) => k.wert)).toEqual([...KANAL_KATEGORIEN]);
        expect(kanalPrioritaeten().map((p) => p.wert)).toEqual([...KANAL_PRIORITAETEN]);
        expect(kanalKategorien().find((k) => k.wert === "karteninhalt")?.text).toBe("Karteninhalt");
        expect(kanalPrioritaeten().find((p) => p.wert === "dringend")?.text).toBe("dringend");
    });

    it("ein langer Bezug kürzt den Titel auf 120 Zeichen, mit Auslassung", () => {
        const lang = kanalTitel(meldung({ bezugName: "W".repeat(300) }));
        expect(lang).toHaveLength(KANAL_TITEL_MAX);
        expect(lang.endsWith("…")).toBe(true);
    });

    it("🔴 „Weiterreichen“ ist gesperrt, solange Titel oder Nachricht fehlen oder zu lang sind, mit einem Satz", () => {
        const ok = neuerKanalEntwurf(meldung());
        expect(kanalSperre(ok)).toBeUndefined();
        expect(t(kanalSperre({ ...ok, titel: "  " })!)).toBe("Der Titel fehlt.");
        expect(t(kanalSperre({ ...ok, nachricht: "" })!)).toBe("Die Nachricht fehlt.");
        expect(kanalSperre({ ...ok, titel: "x".repeat(121) })).toBe("community.kanal.sperre.titelLang");
        expect(kanalSperre({ ...ok, nachricht: "x".repeat(8001) })).toBe("community.kanal.sperre.nachrichtLang");
    });

    it("was an den Server geht, ist getrimmt und passt zum Vertrag", () => {
        const body = kanalBody({ ...neuerKanalEntwurf(meldung()), titel: "  Titel  ", nachricht: " Text \n" });
        expect(body).toEqual({ kategorie: "karteninhalt", prioritaet: "hoch", titel: "Titel", nachricht: "Text" });
        expect(Value.Check(AnKanalBody, { operationId: "a2680c08-0000-4000-9000-000000000009", ...body })).toBe(true);
    });

    it("der Entwurf zählt erst, wenn jemand etwas geändert hat", () => {
        const anfang = neuerKanalEntwurf(meldung());
        expect(kanalHatEntwurf({ ...anfang }, anfang)).toBe(false);
        expect(kanalHatEntwurf({ ...anfang, titel: "Anders" }, anfang)).toBe(true);
        expect(kanalHatEntwurf({ ...anfang, prioritaet: "niedrig" }, anfang)).toBe(true);
    });

    it("die Drossel des Kanals hat einen eigenen Satz; die übrigen bleiben", () => {
        expect(t(kanalFehlerSatz("community.fehler.zuViele"))).toContain("Grenze des Kanals");
        expect(kanalFehlerSatz("community.fehler.netz")).toBe("community.fehler.netz");
    });

    it("alle neuen Sätze stehen in allen Sprachtafeln", () => {
        const tafeln = { en, fr, nl, it: itTafel, es, pl, da, sv } as Record<string, Record<string, string>>;
        const neu = Object.keys(de).filter(
            (key) =>
                key.startsWith("community.korrektur.") ||
                key.startsWith("community.kanal.") ||
                key.startsWith("community.verknuepfen.") ||
                key === "admin.event.system.community_korrektur_verknuepft" ||
                key === "admin.event.system.community_an_kanal",
        );
        expect(neu.length).toBe(38);
        for (const [code, tafel] of Object.entries(tafeln)) {
            for (const key of neu) expect(tafel[key], `${code} ${key}`).toBeTypeOf("string");
        }
    });
});

describe("die Aufrufe an der Leitung", () => {
    interface Aufruf {
        url: string;
        methode: string;
        body: Record<string, unknown> | undefined;
    }
    function holer(antworten: Response[]): { fetcher: typeof fetch; aufrufe: Aufruf[] } {
        const aufrufe: Aufruf[] = [];
        const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
            aufrufe.push({
                url: String(url),
                methode: init?.method ?? "GET",
                body: typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined,
            });
            const antwort = antworten.shift();
            if (antwort === undefined) throw new Error("keine Antwort vorbereitet");
            return antwort;
        }) as typeof fetch;
        return { fetcher, aufrufe };
    }
    const json = (body: unknown): Response =>
        new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

    it("Kandidaten lesen (GET), Korrektur verknüpfen und weiterreichen (POST mit einer Kennung je Schritt)", async () => {
        const { fetcher, aufrufe } = holer([
            json({ quelle: "objekt", kandidaten: [] }),
            json({ nummer: "COM-000123", revision: 3 }),
            json({ nummer: "COM-000123", ops: "OPS-000134" }),
        ]);
        const gelesen = await ladeKorrekturKandidaten("COM-000123", fetcher);
        expect(gelesen.quelle).toBe("objekt");
        // Die Kurzformen der Schritte gehen an `fetch`.
        const alt = globalThis.fetch;
        globalThis.fetch = fetcher;
        try {
            await verknuepfeKorrektur("COM-000123", OPERATION);
            const antwort = await reicheAnKanalWeiter("COM-000123", {
                kategorie: "bug",
                prioritaet: "normal",
                titel: "COM-000123 · Lage falsch · Wehrheim",
                nachricht: "Aus Community-Vorgang COM-000123.",
            });
            expect(antwort.ops).toBe("OPS-000134");
        } finally {
            globalThis.fetch = alt;
        }
        expect(aufrufe.map((a) => `${a.methode} ${a.url}`)).toEqual([
            "GET /api/community/vorgaenge/COM-000123/korrektur-kandidaten",
            "POST /api/community/vorgaenge/COM-000123/korrektur",
            "POST /api/community/vorgaenge/COM-000123/an-kanal",
        ]);
        expect(aufrufe[1]!.body).toMatchObject({ ziel: OPERATION });
        expect(aufrufe[2]!.body).toMatchObject({ kategorie: "bug", prioritaet: "normal" });
        // Nur diese Felder gehen an den Kanal: nie ein Name, eine Adresse oder ein Text des Melders.
        expect(Object.keys(aufrufe[2]!.body ?? {}).sort()).toEqual([
            "kategorie",
            "nachricht",
            "operationId",
            "prioritaet",
            "titel",
        ]);
        for (const a of aufrufe.slice(1)) expect(a.body?.["operationId"]).toMatch(/^[0-9a-f-]{36}$/u);
        // Die Kennungen sind frei, sobald die Schritte durch sind.
        expect(kennung("COM-000123", "an-kanal")).toBeTypeOf("string");
        kennungFrei("COM-000123", "an-kanal");
    });
});

describe("⚙ trägt den Vorgang als Herkunft bis zur Kopfzeile", () => {
    const bezug = (objektId: string): VorgangBezug & { objektArt: "place"; objektId: string } => ({
        art: "objekt",
        objektArt: "place",
        objektId,
        name: "Wehrheim",
        typ: "Stadt",
        lage: { x: 500, y: 400 },
        vorschlagLage: null,
        naechsterOrt: null,
    });
    const ORT = "8d3e0c2a-1111-4000-8000-000000000001";

    it("die Steuerung reicht die COM-Nummer an die Seite weiter; ohne Objekt öffnet nichts", () => {
        const steuerung = createRedaktion();
        const geoeffnet: [string, string][] = [];
        steuerung.verbinde({
            fenster: createWerkzeugfenster(undefined),
            zeigeMeldungen: () => undefined,
            zeige: () => undefined,
            oeffneImEditor: (b, vorgang) => geoeffnet.push([b.objektId, vorgang]),
        });
        steuerung.oeffneImEditor(bezug(ORT), "COM-000123");
        steuerung.oeffneImEditor({ ...bezug(ORT), objektArt: null, objektId: null }, "COM-000124");
        expect(geoeffnet).toEqual([[ORT, "COM-000123"]]);
    });

    it("🔴 die Herkunft steht, bevor das Werkzeug öffnet, und gilt nur am Bezugsobjekt", async () => {
        const stand = shallowRef<FensterStand>({ fenster: [], zaehler: 0 });
        const abruf = vi.fn<typeof fetch>(async () => new Response("{}"));
        const ziel = { fetch: abruf as unknown as typeof fetch };
        const zurueck = installiereHerkunft(stand, ziel);
        try {
            // So legt `redaktion-anbindung.ts` es an: erst die Herkunft setzen, dann das Werkzeug öffnen.
            const reihenfolge: string[] = [];
            const oeffneWerkzeug = (): void => {
                reihenfolge.push(herkunftFuer(`/api/editor/places/${ORT}`, "PATCH") ?? "ohne");
            };
            setzeHerkunft("COM-000123", ORT, "ortseditor");
            oeffneWerkzeug();
            expect(reihenfolge).toEqual(["COM-000123"]);
            await ziel.fetch(`http://localhost/api/editor/places/${ORT}`, { method: "PATCH", body: "{}" });
            expect(new Headers(abruf.mock.calls[0]?.[1]?.headers).get("Avesmaps-Herkunft")).toBe("COM-000123");
            await ziel.fetch("http://localhost/api/editor/places/8d3e0c2a-2222-4000-8000-000000000002", {
                method: "PATCH",
                body: "{}",
            });
            expect(new Headers(abruf.mock.calls[1]?.[1]?.headers).get("Avesmaps-Herkunft")).toBeNull();
        } finally {
            zurueck();
        }
    });
});
