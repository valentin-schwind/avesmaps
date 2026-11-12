import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NewsEintrag } from "@avesmaps3d/shared";
import {
    createNeuigkeiten,
    gesehenBis,
    istNeu,
    merkeGesehenBis,
    nachMonaten,
    rubrikName,
    textStuecke,
} from "../src/news/news.ts";
import { kreisVon, platzHinweis, schienenWert } from "../src/news/pflege.ts";

/**
 * Die Neuigkeiten im Browser (WI-0139 N5, N7).
 *
 * 🔴 **Gelesenes verschwindet nicht** (Betreiber 2026-10-13): Was seit dem letzten Öffnen dazukam, trägt die Marke „neu“; alles Frühere
 * bleibt stehen, nur leiser. Der Lesestand liegt allein im Browser — geht er verloren, ist alles einmal wieder neu, und das ist der
 * harmloseste denkbare Fehler.
 */

/**
 * Die Tests laufen in Node, dort gibt es kein `window`. Ein winziger Speicher reicht; wie er sich verhält, ist der Punkt — und der
 * letzte Fall zeigt, dass es auch OHNE ihn geht (privates Fenster, geleerte Seitendaten).
 */
function speicherAn(): Map<string, string> {
    const inhalt = new Map<string, string>();
    (globalThis as { window?: unknown }).window = {
        localStorage: {
            getItem: (schluessel: string) => inhalt.get(schluessel) ?? null,
            setItem: (schluessel: string, wert: string) => void inhalt.set(schluessel, wert),
            clear: () => inhalt.clear(),
        },
    };
    return inhalt;
}

function speicherAus(): void {
    delete (globalThis as { window?: unknown }).window;
}

const eintrag = (id: number, datum: string, rubrik = "karte"): NewsEintrag => ({
    id,
    datum,
    titel: `Titel ${String(id)}`,
    text: "Ein Satz für normale Leser.",
    rubrik,
});

describe("Neuigkeiten: was neu ist", () => {
    let speicher: Map<string, string>;

    beforeEach(() => {
        speicher = speicherAn();
    });

    afterEach(speicherAus);

    it("🔴 ohne Lesestand ist nichts „neu“ — sonst leuchtete beim ersten Öffnen alles", () => {
        expect(gesehenBis()).toBeNull();
        expect(istNeu(eintrag(7, "2026-10-13"), null)).toBe(false);
    });

    it("nach dem ersten Öffnen ist neu, was danach dazukam", () => {
        merkeGesehenBis(7);
        expect(gesehenBis()).toBe(7);
        expect(istNeu(eintrag(8, "2026-10-14"), gesehenBis())).toBe(true);
        expect(istNeu(eintrag(7, "2026-10-13"), gesehenBis())).toBe(false);
        expect(istNeu(eintrag(6, "2026-10-12"), gesehenBis())).toBe(false);
    });

    it("ein unbrauchbarer Lesestand gilt als keiner", () => {
        speicher.set("avm.neuigkeiten.gesehen-bis", "übermorgen");
        expect(gesehenBis()).toBeNull();
        speicher.set("avm.neuigkeiten.gesehen-bis", "-3");
        expect(gesehenBis()).toBeNull();
    });

    it("gruppiert nach Monaten, in der Reihenfolge, die der Server liefert", () => {
        const monate = nachMonaten([
            eintrag(9, "2026-10-13"),
            eintrag(8, "2026-10-12"),
            eintrag(7, "2026-09-30"),
            eintrag(6, "2026-09-01"),
        ]);
        expect(monate.map((monat) => [monat.monat, monat.eintraege.length])).toEqual([
            ["2026-10", 2],
            ["2026-09", 2],
        ]);
    });

    it("eine unbekannte Rubrik bekommt keine Marke, statt eine erfundene zu zeigen", () => {
        expect(rubrikName("karte")).toBe("Karte");
        expect(rubrikName("wetter")).toBeNull();
    });

    it("🔴 das Öffnen lädt, merkt den neuen Stand und hält den alten für diese Sitzung fest", async () => {
        merkeGesehenBis(7);
        const neuigkeiten = createNeuigkeiten(
            async () =>
                new Response(JSON.stringify({ stand: "2026-10-14", eintraege: [eintrag(9, "2026-10-14")] }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                }),
        );
        await neuigkeiten.oeffnen();
        // Der Schnitt bleibt der des vorigen Öffnens — sonst wäre nichts mehr neu, kaum dass man hinsieht.
        expect(neuigkeiten.stand.value).toBe(7);
        expect(istNeu(neuigkeiten.liste.value!.eintraege[0]!, neuigkeiten.stand.value)).toBe(true);
        // Für das nächste Öffnen ist der Stand nachgezogen.
        expect(gesehenBis()).toBe(9);
    });

    it("🔴 ohne jeden Speicher läuft alles weiter: nichts ist neu, nichts bricht", async () => {
        speicherAus();
        expect(gesehenBis()).toBeNull();
        expect(() => merkeGesehenBis(9)).not.toThrow();
        const neuigkeiten = createNeuigkeiten(
            async () =>
                new Response(JSON.stringify({ stand: "2026-10-14", eintraege: [eintrag(9, "2026-10-14")] }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                }),
        );
        await neuigkeiten.oeffnen();
        expect(neuigkeiten.liste.value?.eintraege).toHaveLength(1);
        expect(istNeu(eintrag(9, "2026-10-14"), neuigkeiten.stand.value)).toBe(false);
    });

    it("ein Fehler beim Laden sagt es, statt leer dazustehen", async () => {
        const neuigkeiten = createNeuigkeiten(async () => new Response("", { status: 500 }));
        await neuigkeiten.oeffnen();
        expect(neuigkeiten.fehler.value).toBe(true);
        expect(neuigkeiten.laedt.value).toBe(false);
    });
});

describe("Neuigkeiten: Adressen im Eintragstext", () => {
    it("eine Adresse mitten im Satz wird ein Verweis, der Satz bleibt Text", () => {
        expect(textStuecke("Schaut vorbei: https://avesmaps.de und sagt uns Bescheid.")).toEqual([
            { art: "text", wert: "Schaut vorbei: " },
            { art: "verweis", wert: "https://avesmaps.de" },
            { art: "text", wert: " und sagt uns Bescheid." },
        ]);
    });

    it("💣 der Punkt am Ende gehört dem Satz, nicht der Adresse", () => {
        expect(textStuecke("Mehr dazu: https://www.youtube.com/watch?v=gBJn-d_B3w4.")).toEqual([
            { art: "text", wert: "Mehr dazu: " },
            { art: "verweis", wert: "https://www.youtube.com/watch?v=gBJn-d_B3w4" },
            { art: "text", wert: "." },
        ]);
    });

    it("⚠️ bei der Klammer wird gezählt: der Pfad behält seine, der Satz bekommt seine zurück", () => {
        expect(textStuecke("(siehe https://de.wikipedia.org/wiki/Aventurien_(Welt))")).toEqual([
            { art: "text", wert: "(siehe " },
            { art: "verweis", wert: "https://de.wikipedia.org/wiki/Aventurien_(Welt)" },
            { art: "text", wert: ")" },
        ]);
    });

    it("🔴 nur http(s) wird ein Verweis — alles andere bleibt Text", () => {
        expect(textStuecke("Unter www.example.de oder javascript:alert(1) steht nichts.")).toEqual([
            { art: "text", wert: "Unter www.example.de oder javascript:alert(1) steht nichts." },
        ]);
        expect(textStuecke("Kaputt: https://. und sonst nichts")).toEqual([
            { art: "text", wert: "Kaputt: https://. und sonst nichts" },
        ]);
    });

    it("ein Text ohne Adresse ist ein Stück, ein leerer Text keines", () => {
        expect(textStuecke("Ein Satz für normale Leser.")).toEqual([
            { art: "text", wert: "Ein Satz für normale Leser." },
        ]);
        expect(textStuecke("")).toEqual([]);
    });
});

describe("Neuigkeiten: die Pflege", () => {
    it("🔴 der Kreis sagt den Zustand: ○ Entwurf, ● sichtbar, ◐ versteckt", () => {
        expect(kreisVon({ zustand: "entwurf" })).toBe("leer");
        expect(kreisVon({ zustand: "sichtbar" })).toBe("voll");
        expect(kreisVon({ zustand: "versteckt" })).toBe("halb");
    });

    it("an der Schiene steht die Zahl der wartenden Entwürfe, sonst nichts", () => {
        expect(schienenWert({ entwuerfe: 2 })).toBe("2");
        expect(schienenWert({ entwuerfe: 0 })).toBeUndefined();
        expect(schienenWert(null)).toBeUndefined();
    });
});

/**
 * Wo ein neuer Eintrag landet (WI-0217). 🔴 Die Reihenfolge ist das Datum: Wer unter einem Eintrag einfügt, bleibt dort nur mit einem Datum
 * zwischen dem Eintrag darüber und dem darunter. Dieselbe Regel rechnet der Server (`apps/server/test/news.test.ts`, „neu und
 * zwischendrin“); der Satz im Editor darf nichts versprechen, was das Speichern nicht hält.
 */
describe("Neuigkeiten: der Platz eines neuen Eintrags", () => {
    const liste = [
        { id: 5, datum: "2026-10-15" },
        { id: 4, datum: "2026-10-15" },
        { id: 3, datum: "2026-10-10" },
        { id: 2, datum: "2026-10-06" },
    ];

    it("zwischen zwei Tagen bleibt er mit einem Datum dazwischen, die Grenzen eingeschlossen", () => {
        expect(platzHinweis(liste, 3, "2026-10-08")).toMatchObject({
            bleibt: true,
            satz: { key: "admin.news.platz.zwischen" },
        });
        expect(platzHinweis(liste, 3, "2026-10-10").bleibt).toBe(true);
        expect(platzHinweis(liste, 3, "2026-10-06").bleibt).toBe(true);
    });

    it("🔴 außerhalb rückt er beim Speichern an seinen Platz, und der Satz sagt es", () => {
        expect(platzHinweis(liste, 3, "2026-10-11")).toEqual({
            bleibt: false,
            satz: { key: "admin.news.platz.rueckt" },
        });
        expect(platzHinweis(liste, 3, "2026-10-01").bleibt).toBe(false);
    });

    it("zwischen zwei Einträgen desselben Tages gibt es nur diesen Tag", () => {
        expect(platzHinweis(liste, 5, "2026-10-15")).toMatchObject({
            bleibt: true,
            satz: { key: "admin.news.platz.gleich" },
        });
        expect(platzHinweis(liste, 5, "2026-10-14").bleibt).toBe(false);
    });

    it("ganz oben ab dem jüngsten Tag, ganz unten bis zum ältesten", () => {
        expect(platzHinweis(liste, null, "2026-10-17")).toMatchObject({
            bleibt: true,
            satz: { key: "admin.news.platz.oben" },
        });
        expect(platzHinweis(liste, null, "2026-10-14").bleibt).toBe(false);
        expect(platzHinweis(liste, 2, "2026-09-30")).toMatchObject({
            bleibt: true,
            satz: { key: "admin.news.platz.unten" },
        });
    });

    it("ohne vollständiges Datum kein Satz; in einer leeren Liste bleibt jeder", () => {
        expect(platzHinweis(liste, 3, "2026-10")).toEqual({ satz: null, bleibt: false });
        expect(platzHinweis([], null, "2026-10-17")).toEqual({ satz: null, bleibt: true });
    });
});
