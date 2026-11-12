import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { wikiNamespaceTafel, type WikisyncBereich } from "@avesmaps3d/shared";
import { describe, expect, it } from "vitest";
import type { GelesenerDumpArtikel } from "../src/wiki/dump/seiten-sammler.ts";
import { sprachartikelObjekt } from "../src/wiki/abgleich/lokal.ts";
import { berechnePlan, laufIstGrundlage, type PlanObjekt, type PlanZeile } from "../src/wiki/abgleich/plan.ts";
import {
    GRUND_NEU,
    GRUND_NICHT_AVENTURISCH,
    GRUND_NICHT_IM_DUMP,
    GRUND_WIEDER,
    neuerArtikelId,
} from "../src/wiki/abgleich/sprachen.ts";
import type { VorschauZeile } from "../src/wiki/abgleich/uebernahme/protokoll.ts";
import { sprachenSchreiber } from "../src/wiki/abgleich/uebernahme/sprachen.ts";
import { entscheideAlles } from "../src/wiki/abgleich/uebernahme/uebernehmen.ts";

/**
 * Der Plan des Bereichs `sprachen` (WI-0261 S3), REIN: echte Sprachartikel aus der Fixture gegen einen erfundenen Bestand. Artikelzentriert: neu → anlegen, geändert → ändern, verschwunden oder
 * nicht mehr aventurisch → still legen, rein Myranisches bleibt draußen. Dazu die Entscheidung der Übernahme über dieselben Zeilen (`entscheideAlles`): Felder bestehender Artikel gehen als Spalten,
 * neue Artikel an den Listen-Schreiber.
 */

const FIXTURE = fileURLToPath(new URL("./fixtures/wiki-sprache-seiten.json", import.meta.url));
const SEITEN = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { seiten: GelesenerDumpArtikel[] }).seiten.map(
    (seite) => ({
        ...seite,
        weiterleitung: null,
    }),
);
const seite = (titel: string): GelesenerDumpArtikel =>
    SEITEN.find((kandidat) => kandidat.titel === titel) as GelesenerDumpArtikel;

const ID = {
    thorwalsch: "a1000000-0000-4000-8000-000000000001",
    horathi: "a1000000-0000-4000-8000-000000000002",
    verschwunden: "a1000000-0000-4000-8000-000000000003",
    tesumurrisch: "a1000000-0000-4000-8000-000000000004",
    alaani: "a1000000-0000-4000-8000-000000000005",
    umgezogen: "a1000000-0000-4000-8000-000000000006",
};

/** Eine Zeile von `wiki_sprache_artikel`, wie der Lader sie liest. */
function artikel(id: string, titel: string, werte: Record<string, unknown> = {}, aktiv = true): PlanObjekt {
    return sprachartikelObjekt({
        id,
        schluessel: titel.toLowerCase(),
        titel,
        is_active: aktiv,
        unbekannt: [],
        navigation: [],
        ...werte,
    });
}

/** Horathi genau so, wie das Wiki es führt: Der Plan hat nichts zu sagen. */
const HORATHI = {
    name: "Horathi",
    sprachfamilie: "Garethi",
    vorstufen: "Aureliani, Bosparano, Garethi",
    schrift: "Kusliker Zeichen",
    weitere_verbreitung: "Horasreich und dessen Kolonien im Südmeer",
    kurzbeschreibung:
        "Das Horathi ist der im Horasreich gesprochene Dialekt des Garethi. Es wird etwas weicher und melodischer gesprochen und weist viele alte Lehnwörter aus dem Bosparano auf sowie neuerdings auch Lehnwörter aus dem südlichen Garethi-Dialekt Brabaci, gilt aber sonst als recht reiner Garethi-Dialekt.",
    navigation: ["Nav Sprachfamilie Garethi"],
    vorstufen_roh: "[[Aureliani]], [[Bosparano]], [[Garethi]]",
    schrift_roh: "[[Kusliker Zeichen]]",
    weitere_verbreitung_roh: "[[Horasreich]] und dessen Kolonien im [[Südmeer]]",
};

function plan(
    objekte: readonly PlanObjekt[],
    optionen: {
        seiten?: readonly GelesenerDumpArtikel[];
        gefunden?: Map<string, GelesenerDumpArtikel[]>;
        legacy?: boolean;
    } = {},
): ReturnType<typeof berechnePlan> {
    return berechnePlan({
        bereiche: ["sprachen"],
        objekte,
        dump: { gefunden: optionen.gefunden ?? new Map(), kandidaten: [], sprachen: optionen.seiten ?? SEITEN },
        tafel: wikiNamespaceTafel(),
        legacyBereiche: new Set<WikisyncBereich>(optionen.legacy === true ? ["sprachen"] : []),
        bekannteTitel: new Set(),
    });
}

const zeilenVon = (zeilen: readonly PlanZeile[], name: string): PlanZeile[] =>
    zeilen.filter((zeile) => zeile.objektName === name);

/** Die Zeilen eines Laufs, wie die Übernahme sie liest (nur Feldzeilen). */
const alsVorschau = (zeilen: readonly PlanZeile[]): VorschauZeile[] =>
    zeilen
        .filter((zeile): zeile is PlanZeile & { feld: string } => zeile.feld !== null)
        .map((zeile, index) => ({
            id: index + 1,
            bereich: zeile.bereich,
            objektArt: zeile.objektArt,
            objektId: zeile.objektId,
            objektName: zeile.objektName,
            objekte: zeile.objekte,
            objektIds: zeile.objektIds,
            artikel: zeile.artikel,
            feld: zeile.feld,
            alt: zeile.alt,
            altZustand: zeile.altZustand,
            neu: zeile.neu,
            neuZustand: zeile.neuZustand,
            eigentuemer: zeile.eigentuemer,
            wirkung: zeile.wirkung,
        }));

describe("WikiSync Sprachen: der Plan (artikelzentriert)", () => {
    it("🔴 ohne Bestand: jeder aventurische Artikel wird angelegt, mit allen Feldern, die das Wiki nennt; Tesumurrisch bleibt draußen", () => {
        const ergebnis = plan([]);
        const zahlen = ergebnis.zahlen.sprachen;
        // Acht der neun Seiten sind aventurisch (Mholurisch und Bansumitisch als Grenzfälle mit).
        expect(zahlen).toMatchObject({ objekte: 0, angelegt: 8, stillgelegt: 0, befunde: 0, neueArtikel: 0 });
        expect(zeilenVon(ergebnis.zeilen, "Tesumurrisch")).toEqual([]);
        const garethi = zeilenVon(ergebnis.zeilen, "Garethi");
        const id = neuerArtikelId("garethi");
        expect(
            garethi.every(
                (zeile) => zeile.objektId === id && zeile.objektIds.length === 1 && zeile.objektIds[0] === id,
            ),
        ).toBe(true);
        expect(garethi.every((zeile) => zeile.objektArt === "sprache_artikel" && zeile.status === "neu")).toBe(true);
        expect(garethi.every((zeile) => zeile.eigentuemer === "wiki" && zeile.wirkung === "uebernommen")).toBe(true);
        expect(garethi[0]).toMatchObject({ feld: "artikel", alt: null, neu: "Garethi", grund: GRUND_NEU });
        expect(garethi.map((zeile) => zeile.feld)).toEqual([
            "artikel",
            "name",
            "sprachfamilie",
            "vorstufen",
            "schrift",
            "sprecheranzahl",
            "offizielle_sprache",
            "weitere_verbreitung",
            "kurzbeschreibung",
            "navigation",
            "roh_vorstufen",
            "roh_schrift",
            "roh_offizielle_sprache",
            "roh_weitere_verbreitung",
        ]);
        // Mholurisch nennt nur Name, Verbreitung und Kurzbeschreibung: Leere Felder sind keine Zeile.
        expect(zeilenVon(ergebnis.zeilen, "Mholurisch").map((zeile) => zeile.feld)).toEqual([
            "artikel",
            "name",
            "weitere_verbreitung",
            "kurzbeschreibung",
            "roh_weitere_verbreitung",
        ]);
    });

    it("🔴 mit Bestand: geändert → ändern, gleich → nichts, verschwunden oder nicht mehr aventurisch → still legen, still gelegt und zurück → beleben", () => {
        const objekte = [
            // Thorwalsch: Das Wiki zählt jetzt mehr Sprecher, und die Leiste fehlte.
            artikel(ID.thorwalsch, "Thorwalsch", {
                name: "Thorwalsch",
                sprachfamilie: "Sprachfamilie Thorwalsch",
                schrift: "Thorwaler-Runen",
                sprecheranzahl: "über 70.000",
                offizielle_sprache: "Thorwal",
                weitere_verbreitung: "Gjalskerland",
                kurzbeschreibung:
                    "Thorwalsch ist die aus dem (Alt-)Hjaldingsch entstandene Sprache der Thorwaler. Je nach Region sind Einflüsse aus dem Garethi, Orkisch und Nujuka zu erkennen. Die Sprachen der Gjalsker (Gjalskisch) und Fjarninger (Fjarningsch) haben sich aus ihr entwickelt, das Alberned ist von ihr beeinflusst.",
                schrift_roh: "[[Thorwaler-Runen]]",
                offizielle_sprache_roh: "[[Thorwal (Staat)|Thorwal]]",
                weitere_verbreitung_roh: "[[Gjalskerland]]",
            }),
            artikel(ID.horathi, "Horathi", HORATHI),
            // Nicht mehr im Dump.
            artikel(ID.verschwunden, "Altes Kauderwelsch", { name: "Altes Kauderwelsch" }),
            // Im Dump, aber nicht mehr aventurisch.
            artikel(ID.tesumurrisch, "Tesumurrisch", { name: "Tesumurrisch" }),
            // Still gelegt und wieder da.
            artikel(ID.alaani, "Alaani", { name: "Alaani" }, false),
        ];
        const ergebnis = plan(objekte);
        expect(ergebnis.zahlen.sprachen).toMatchObject({
            objekte: 4,
            gefunden: 2,
            nichtImDump: 2,
            stillgelegt: 2,
            // Neu: Garethi, Ta-Haya, Angram, Mholurisch, Bansumitisch; belebt: Alaani.
            angelegt: 6,
        });

        const thorwalsch = zeilenVon(ergebnis.zeilen, "Thorwalsch");
        expect(thorwalsch.map((zeile) => [zeile.feld, zeile.alt, zeile.neu, zeile.status, zeile.wirkung])).toEqual([
            ["sprecheranzahl", "über 70.000", "über 80.000", "geaendert", "uebernommen"],
            ["navigation", null, "Nav Sprachfamilie Thorwalsch", "neu", "uebernommen"],
        ]);
        expect(thorwalsch.every((zeile) => zeile.objektId === ID.thorwalsch)).toBe(true);
        expect(zeilenVon(ergebnis.zeilen, "Horathi")).toEqual([]);

        const weg = zeilenVon(ergebnis.zeilen, "Altes Kauderwelsch");
        expect(weg).toHaveLength(1);
        expect(weg[0]).toMatchObject({
            feld: "artikel",
            alt: "Altes Kauderwelsch",
            neu: null,
            status: "zu_entfernen",
            wirkung: "uebernommen",
            grund: GRUND_NICHT_IM_DUMP,
        });
        expect(zeilenVon(ergebnis.zeilen, "Tesumurrisch")).toEqual([
            expect.objectContaining({ feld: "artikel", status: "zu_entfernen", grund: GRUND_NICHT_AVENTURISCH }),
        ]);

        const alaani = zeilenVon(ergebnis.zeilen, "Alaani");
        expect(alaani[0]).toMatchObject({
            feld: "artikel",
            alt: null,
            neu: "Alaani",
            status: "neu",
            grund: GRUND_WIEDER,
        });
        expect(alaani.every((zeile) => zeile.objektId === ID.alaani)).toBe(true);
        // Name stimmt schon; die übrigen Felder kommen mit.
        expect(alaani.map((zeile) => zeile.feld)).not.toContain("name");
        expect(alaani.map((zeile) => zeile.feld)).toContain("sprachfamilie");
    });

    it("eine Weiterleitung legt still und nennt das Ziel", () => {
        const umgezogen = artikel(ID.umgezogen, "Altgarethi", { name: "Altgarethi" });
        const gefunden = new Map<string, GelesenerDumpArtikel[]>([
            ["Altgarethi", [{ titel: "Altgarethi", ns: 0, weiterleitung: "Garethi", text: "" }]],
        ]);
        const ergebnis = plan([umgezogen], { gefunden });
        expect(zeilenVon(ergebnis.zeilen, "Altgarethi")).toEqual([
            expect.objectContaining({
                feld: "artikel",
                status: "zu_entfernen",
                grund: "Weiterleitung auf Garethi: wird still gelegt",
            }),
        ]);
    });

    it("🔴 gehört der Bereich dem Legacy-Zug (nicht umgeschaltet), ist alles nur Vorschau: Eigentümer legacy, Wirkung Befund", () => {
        const ergebnis = plan([artikel(ID.verschwunden, "Altes Kauderwelsch")], { legacy: true });
        expect(ergebnis.zeilen.length).toBeGreaterThan(0);
        expect(ergebnis.zeilen.every((zeile) => zeile.eigentuemer === "legacy" && zeile.wirkung === "befund")).toBe(
            true,
        );
    });

    it("Befunde statt Raten: zwei Seiten mit demselben Schlüssel, eine kaputte Infobox; beides wird weder angelegt noch still gelegt", () => {
        const doppelt = { ...seite("Garethi"), titel: "garethi" };
        const kaputt = {
            titel: "Kaputtisch",
            ns: 0,
            weiterleitung: null,
            text: "{{Aventurien}}\n{{Infobox Sprache\n|Name=Kaputtisch\n",
        };
        const ergebnis = plan([artikel(ID.horathi, "Kaputtisch")], { seiten: [seite("Garethi"), doppelt, kaputt] });
        expect(ergebnis.zeilen.map((zeile) => [zeile.objektName, zeile.objektArt, zeile.befund, zeile.status])).toEqual(
            [
                ["Garethi", "article", "mehrdeutig", "mehrdeutig"],
                ["Kaputtisch", "sprache_artikel", "infobox_kaputt", "fehlerhaft"],
            ],
        );
        expect(ergebnis.zahlen.sprachen).toMatchObject({ angelegt: 0, stillgelegt: 0, mehrdeutig: 1 });
    });

    it("ohne die Sprachartikel des Dumps (Vergleich EINES Artikels) rechnet der Bereich nichts", () => {
        const ergebnis = berechnePlan({
            bereiche: ["sprachen"],
            objekte: [artikel(ID.horathi, "Horathi", HORATHI)],
            dump: { gefunden: new Map(), kandidaten: [] },
            tafel: wikiNamespaceTafel(),
            bekannteTitel: new Set(),
        });
        expect(ergebnis.zeilen).toEqual([]);
        expect(ergebnis.zahlen.sprachen).toMatchObject({ objekte: 1, uebernommen: 0 });
        expect(ergebnis.zahlen.sprachen?.angelegt).toBeUndefined();
    });

    it("🔴 ein Lauf von vor Stand 10 ist für die Sprachen keine Grundlage", () => {
        expect(laufIstGrundlage("sprachen", "wikisync-parser-9")).toBe(false);
        expect(laufIstGrundlage("sprachen", "wikisync-parser-10")).toBe(true);
        expect(laufIstGrundlage("vorkommen", "wikisync-parser-10")).toBe(true);
    });
});

describe("WikiSync Sprachen: was die Übernahme aus den Zeilen macht (rein)", () => {
    it("🔴 Felder bestehender Artikel gehen als Spalten (ein UPDATE je Objekt), still legen und beleben über `artikel`, neue Artikel an den Listen-Schreiber", () => {
        const objekte = [
            artikel(ID.horathi, "Horathi", { ...HORATHI, sprecheranzahl: "viele" }),
            artikel(ID.verschwunden, "Altes Kauderwelsch", { name: "Altes Kauderwelsch" }),
            artikel(ID.alaani, "Alaani", { name: "Alaani" }, false),
        ];
        const zeilen = alsVorschau(
            plan(objekte, { seiten: [seite("Horathi"), seite("Alaani"), seite("Ta-Haya")] }).zeilen,
        );
        const nachKennung = new Map(objekte.map((objekt) => [objekt.id, objekt]));
        const entscheidung = entscheideAlles("sprachen", zeilen, nachKennung, sprachenSchreiber);
        expect(entscheidung.befunde).toEqual([]);
        const schritt = (id: string, feld: string) =>
            entscheidung.schritte.find((kandidat) => kandidat.objekt.id === id && kandidat.feld === feld);
        // Horathi: Das Wiki kennt keine Sprecheranzahl mehr – die Spalte wird geleert.
        expect(schritt(ID.horathi, "sprecheranzahl")?.wirksam).toEqual({ vorher: "viele", nachher: null });
        // Still legen: `artikel` wird leer.
        expect(schritt(ID.verschwunden, "artikel")?.wirksam).toEqual({ vorher: "Altes Kauderwelsch", nachher: null });
        // Beleben: `artikel` wird der Titel; leere Felder füllt die Übernahme in der Spalte.
        expect(schritt(ID.alaani, "artikel")?.wirksam).toEqual({ vorher: null, nachher: "Alaani" });
        expect(schritt(ID.alaani, "sprachfamilie")?.wirksam).toEqual({
            vorher: null,
            nachher: "Sprachfamilie Tulamidya",
        });
        // Kein Schritt schreibt hinter ↺: Der Sprachartikel IST sein Wiki-Stand.
        expect(entscheidung.schritte.every((kandidat) => kandidat.schnappschuss === undefined)).toBe(true);
        // Ta-Haya ist neu: ein Schritt des Listen-Schreibers mit allen Werten, keine Feldschritte.
        expect(entscheidung.schritte.some((kandidat) => kandidat.objekt.name === "Ta-Haya")).toBe(false);
        expect(entscheidung.liste).toHaveLength(1);
        expect(entscheidung.liste[0]).toMatchObject({
            schluessel: "ta-haya",
            titel: "Ta-Haya",
            unbekannt: [],
            werte: {
                name: "Ta-Haya",
                sprachfamilie: "Waldmenschen-Sprachen",
                schrift: "schriftlos",
                weitere_verbreitung: "Meridiana",
                navigation: "Nav Waldmenschendialekte",
                schrift_roh: "schriftlos",
                weitere_verbreitung_roh: "[[Meridiana]]",
            },
        });
    });

    it("🔴 Stand von jetzt: Steht ein neuer Artikel inzwischen im Bestand, wird er nicht angelegt; ein gekürzter Wert bleibt unbekannt", () => {
        const zeilen = alsVorschau(plan([], { seiten: [seite("Ta-Haya")] }).zeilen);
        const lang = zeilen.map((zeile) =>
            zeile.feld === "kurzbeschreibung" ? { ...zeile, neu: "x".repeat(4000) } : zeile,
        );
        const frei = entscheideAlles("sprachen", lang, new Map(), sprachenSchreiber);
        expect(frei.liste[0]).toMatchObject({ unbekannt: ["kurzbeschreibung"] });
        expect(frei.befunde).toEqual([expect.objectContaining({ feld: "kurzbeschreibung", befund: "wert_gekuerzt" })]);

        const schon = artikel(ID.horathi, "Ta-Haya");
        const besetzt = entscheideAlles("sprachen", zeilen, new Map([[schon.id, schon]]), sprachenSchreiber);
        expect(besetzt.liste).toEqual([]);
        expect(besetzt.befunde).toEqual([
            expect.objectContaining({ feld: "artikel", befund: "seit_vorschau_geaendert" }),
        ]);
    });
});
