import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { inSprache, ladeTafel, locale, setLocale } from "../src/i18n/i18n.ts";
import { planerLink, reiseDaten, gebietDerEtappe, verfuegbar, pdfWorte } from "../src/reise-pdf/reise-daten.ts";
import { etappenUhr, rastNachEtappe, reisetage, uhrStimmt } from "../src/reise-pdf/reise-tage.ts";
import { PLANNER_PARAMS } from "../src/route-planner/planner-link.ts";
import { landschaften, optionen, reise, vorkommen } from "./reise-pdf-fixture.ts";

/**
 * „Reise als PDF“ (WI-0306): was das PDF über eine Reise sagt, als reine Daten - die Uhr der Reisetage, die verschobene Rast, die Stationen
 * und Abschnitte, die „Dazu“-Zeilen, die Sprache des PDFs. Wie es aussieht, prüft `reise-pdf-dokument.test.ts`.
 */

beforeAll(async () => {
    await ladeTafel("en");
});
afterEach(() => setLocale("de"));

const eingabe = () => ({
    route: reise(),
    options: optionen(),
    pointNames: new Map<string, string>(),
    landscapes: landschaften(),
    unterwegs: vorkommen(),
});

describe("Die Uhr der Reise", () => {
    it("🔴 rechnet dieselbe Rast wie der Server: die Nacht vor der dritten Etappe", () => {
        const route = reise();
        const uhr = etappenUhr(route);
        expect(uhrStimmt(route, uhr)).toBe(true);
        expect(uhr.map((u) => u.rastDavor)).toEqual([0, 0, 16, 0, 0]);
        expect(uhr[2]?.beginn).toBe(24);
    });

    it("die Rast steht an der Etappe, NACH der gerastet wird", () => {
        expect(rastNachEtappe(reise())).toEqual([0, 16, 0, 0, 0]);
    });

    it("🪤 stimmt die Uhr nicht, bleibt die Rast des Servers und das Tagebuch fällt weg, statt etwas zu erfinden", () => {
        const route = reise();
        route.stages[2]!.rest_hours = 3;
        expect(rastNachEtappe(route)).toEqual(route.stages.map((s) => s.rest_hours));
        expect(reisetage(route, "bett")).toEqual([]);
    });

    it("zwei Reisetage: Gareth bis Ettingen mit Nacht im Gasthaus, dann bis Havena und die Ankunft", () => {
        const tage = reisetage(reise(), "bett");
        expect(tage.map((t) => [t.tag, t.etappen[0]?.from.name, t.etappen.at(-1)?.to.name, t.nacht])).toEqual([
            [0, "Gareth", "Ettingen", "gasthaus"],
            [1, "Ettingen", "Havena", undefined],
        ]);
    });

    it("eine Fahrt über Tage: am ersten Tag „weiter“, dann „unterwegs“ auf ihr, am letzten „bis“", () => {
        const route = reise();
        // Die Flussfahrt dauert 40 Stunden statt 2: drei Nächte an Bord, gebucht wie der Server (Uhr in `etappenUhr`).
        const fahrt = route.stages[4]!;
        fahrt.travel_hours = 40;
        const uhr = etappenUhr({ ...route, stages: route.stages.map((s) => ({ ...s, rest_hours: 0 })) });
        fahrt.rest_hours = uhr[4]!.rastDavor + uhr[4]!.rastUnterwegs;
        const tage = reisetage(route, "bett");
        expect(tage[1]?.weiter).toBe(fahrt);
        const danach = tage.slice(2);
        expect(danach.length).toBeGreaterThanOrEqual(2);
        expect(danach.every((t) => t.ueber === fahrt && t.etappen.length === 0)).toBe(true);
        expect(danach.slice(0, -1).every((t) => t.ankunftUeber === false && t.nacht === "bord")).toBe(true);
        expect(danach.at(-1)).toMatchObject({ ankunftUeber: true, nacht: undefined });
    });

    it("ohne Unterkunft ist die Nacht an Land im Freien", () => {
        expect(reisetage(reise(), "frei")[0]?.nacht).toBe("frei");
    });
});

describe("Die Daten des PDFs", () => {
    it("Titel und Datei in den Wörtern des Planers", () => {
        const daten = reiseDaten(eingabe());
        expect(daten.titel).toBe("Die Reise von Gareth über Elenvina nach Havena");
        expect(daten.datei).toBe("Reise von Gareth nach Havena");
        expect(daten.kopfRechts).toBe("Gareth – Havena · 3.–4. Peraine");
    });

    it("Stationen mit Rolle, Ort und Datum; das Band kennt die Mittel der Strecke", () => {
        const { stationen } = reiseDaten(eingabe());
        expect(stationen.map((s) => [s.name, s.rolle, s.datum])).toEqual([
            ["Gareth", "Start", "ab 3. Peraine"],
            ["Elenvina", "Zwischenziel", "4. Peraine"],
            ["Havena", "Ziel", "an 4. Peraine"],
        ]);
        expect(stationen[0]?.wo).toBe("Metropole · in Alt-Gareth");
        expect(stationen.map((s) => s.strecke)).toEqual([["land"], ["river"], []]);
    });

    it("der Verlauf: Station, Abschnitt, Station, Abschnitt, Station; die Rast an der Etappe vor der Nacht", () => {
        const { verlauf } = reiseDaten(eingabe());
        expect(verlauf.map((v) => v.art)).toEqual(["station", "abschnitt", "station", "abschnitt", "station"]);
        const land = verlauf[1];
        if (land?.art !== "abschnitt") throw new Error("kein Abschnitt");
        expect(land.abschnitt.titel).toBe("Landweg");
        expect(land.abschnitt.etappen.map((e) => e.rast)).toEqual(["", "16,0 Std.", "", ""]);
        expect(land.abschnitt.etappen[0]).toMatchObject({ nr: 1, von: "Gareth", nach: "Weyring", datum: "3." });
    });

    it("🔴 „Dazu“: die Gegend ohne die, die jede Etappe trägt, das tiefste Gebiet mit dem Reich, Boden, Neues unterwegs", () => {
        const { verlauf } = reiseDaten(eingabe());
        const land = verlauf[1];
        if (land?.art !== "abschnitt") throw new Error("kein Abschnitt");
        const erste = land.abschnitt.etappen[0]!.dazu;
        expect(erste.find((d) => d.art === "gegend")?.wert).toBe("Herz des Kontinents");
        expect(erste.find((d) => d.art === "gebiet")).toMatchObject({
            wert: "Baronie Kaiserlich Raulsmark",
            leise: "Königreich Garetien",
        });
        expect(erste.find((d) => d.art === "sprache")?.wert).toBe("Garethi 97 %");
        expect(erste.find((d) => d.label === "Aufgeweichter Boden")?.wert).toBe("+20 %");
        expect(erste.find((d) => d.art === "neu")?.wert).toBe("1 Handelsware, 1 Tierart (Alaun, Auerochse …)");
        const fluss = verlauf[3];
        if (fluss?.art !== "abschnitt") throw new Error("kein Abschnitt");
        expect(fluss.abschnitt.dazu.find((d) => d.label === "Fahrt")?.wert).toBe("Flusssegler, flussabwärts");
    });

    it("das Tagebuch: Tag, Monat, Ziel, Weg und Nacht", () => {
        const { tage } = reiseDaten(eingabe());
        expect(tage).toEqual([
            {
                gross: "3.",
                klein: "Peraine",
                was: "Gareth – Ettingen",
                wege: "Reichsstraße 3",
                nacht: "Nacht im Gasthaus",
            },
            {
                gross: "4.",
                klein: "Peraine",
                was: "Ettingen – Havena",
                wege: "Reichsstraße 3, Der Große Fluss",
                nacht: "Ankunft",
            },
        ]);
    });

    it("was die Reise trägt: ohne Kosten keine Kosten, das übrige da", () => {
        expect(verfuegbar(reiseDaten(eingabe()))).toEqual({
            etappen: true,
            profil: true,
            kosten: false,
            schiffe: true,
            gebiete: true,
            unterwegs: true,
            tagebuch: true,
            qr: true,
        });
    });

    it("🔴 in einer anderen Sprache als die Seite: englische Wörter und Zahlen, die Seite bleibt deutsch", () => {
        const { daten, worte } = inSprache("en", () => ({ daten: reiseDaten(eingabe()), worte: pdfWorte() }));
        expect(locale.value).toBe("de");
        expect(daten.titel).toBe("The journey from Gareth via Elenvina to Havena");
        expect(daten.stationen[0]?.datum).toBe("from 3. Peraine");
        expect(worte.verlauf).toBe("Itinerary");
        expect(reiseDaten(eingabe()).titel).toBe("Die Reise von Gareth über Elenvina nach Havena");
    });
});

describe("Gebiet und Link", () => {
    it("das tiefste Gebiet einer Kette und das Reich unter der obersten Krone", () => {
        expect(
            gebietDerEtappe([
                { id: "a", name: "Kaiserreich", parentId: null },
                { id: "b", name: "Fürstentum Kosch", parentId: "a" },
                { id: "c", name: "Grafschaft Ferdok", parentId: "b" },
                { id: "d", name: "Baronie Nadoret", parentId: "c" },
            ]),
        ).toEqual({ gebiet: "Baronie Nadoret", reich: "Fürstentum Kosch" });
        expect(gebietDerEtappe([{ id: "h", name: "Havena", parentId: null }])).toEqual({ gebiet: "Havena", reich: "" });
        expect(gebietDerEtappe([])).toBeNull();
    });

    it("der Planer-Link trägt nur die Angaben des Planers, ohne Kurzlink und ohne Hash", () => {
        const link = planerLink(
            {
                origin: "https://avesmaps.de",
                pathname: "/",
                search: "?route=Gareth~Havena&startMonth=peraine&startDay=3&lang=en&s=abc&labeltune=1",
            },
            PLANNER_PARAMS,
        );
        expect(link).toBe("https://avesmaps.de/?route=Gareth~Havena&startMonth=peraine&startDay=3");
    });
});
