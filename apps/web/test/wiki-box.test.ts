import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { WikiBoxStand } from "@avesmaps3d/shared";
import { describe, expect, it } from "vitest";
import { createWikiBoxDaten } from "../src/fenster/wiki-box-daten";
import { wikiLage } from "../src/fenster/wiki-feld";
import {
    drosselBis,
    eigene,
    feldNamenZu,
    schluesselText,
    standZeile,
    veraltete,
    wikiBoxLage,
    type WikiBoxFeld,
    type WikiBoxLageEingabe,
} from "../src/fenster/wiki-box";

/**
 * Die Rechnung der Wiki-Box (WI-0253; Entwurf `review/wi-0253/wikifeld-sync-mockup.html`, abgenommen 2026-10-25): wann welcher der drei Knöpfe gesperrt ist und warum, welche Zeile den Stand nennt, welche
 * Felder ein Sync ändern würde.
 *
 * - **Soll:** Zuweisen und Entfernen wirken auf dem Server, darum sperren bei ungespeicherten Änderungen ALLE drei; bei einer Drosselung (429) nur der Sync, bis zur genannten Zeit; lokal gibt es keinen Abruf, aber
 *   Zuweisen und Entfernen gehen; läuft ein Sync, macht der Knopf der Fortschrittsanzeige Platz.
 * - **Problemfälle:** kein Artikel, kein Recht, die Pause ist vorbei, ein Datum, das keines ist, mehrere Gründe zugleich (der Entwurf geht vor dem laufenden Sync), Felder ohne Gegenstück im Wiki.
 */

const JETZT = Date.parse("2026-10-26T12:00:00Z");

function stand(
    aenderung: Partial<WikiBoxStand["sync"]> = {},
    artikel?: WikiBoxStand["artikel"] | "keiner",
): WikiBoxStand {
    return {
        art: "ort",
        id: "a0000000-0000-4000-8000-000000000001",
        name: "Gareth",
        artikel:
            artikel === "keiner"
                ? null
                : (artikel ?? { key: "gareth", url: "https://de.wiki-aventurica.de/wiki/Gareth", name: "Gareth" }),
        sync: { moeglich: true, laeuft: false, letzter: null, fehler: null, ...aenderung },
    };
}

const eingabe = (aenderung: Partial<WikiBoxLageEingabe> = {}): WikiBoxLageEingabe => ({
    darf: true,
    ungespeichert: false,
    beschaeftigt: false,
    stand: stand(),
    jetzt: JETZT,
    ...aenderung,
});

describe("Wiki-Box: die Knöpfe", () => {
    it("ohne Sperre sind alle drei frei, der Sync-Knopf steht da", () => {
        expect(wikiBoxLage(eingabe())).toEqual({
            knoepfe: true,
            zuweisen: undefined,
            sync: undefined,
            entfernen: undefined,
            syncKnopf: true,
            spaeter: false,
            artikel: true,
        });
    });

    it("🔴 ungespeicherte Änderungen sperren ALLE drei, mit demselben Grund (Zuweisen und Entfernen wirken sofort auf dem Server)", () => {
        const lage = wikiBoxLage(eingabe({ ungespeichert: true }));
        const grund = { art: "ungespeichert" } as const;
        expect([lage.zuweisen, lage.sync, lage.entfernen]).toEqual([grund, grund, grund]);
    });

    it("🔴 der Entwurf geht vor dem laufenden Sync und vor der Drosselung: Der Satz zur Gruppe nennt das Formular", () => {
        const laeuft = wikiBoxLage(eingabe({ ungespeichert: true, stand: stand({ laeuft: true }) }));
        expect([laeuft.zuweisen, laeuft.entfernen]).toEqual([{ art: "ungespeichert" }, { art: "ungespeichert" }]);
        const gedrosselt = wikiBoxLage(
            eingabe({
                ungespeichert: true,
                stand: stand({
                    fehler: { am: "2026-10-26T11:59:00Z", code: "http_429", freiAb: "2026-10-26T12:30:00Z" },
                }),
            }),
        );
        expect(gedrosselt.sync).toEqual({ art: "ungespeichert" });
    });

    it("🔴 bei 429 ist nur der Sync bis zur genannten Zeit gesperrt („Später erneut“); Zuweisen und Entfernen bleiben", () => {
        const fehler = { am: "2026-10-26T11:59:00Z", code: "http_429", freiAb: "2026-10-26T12:30:00Z" };
        const lage = wikiBoxLage(eingabe({ stand: stand({ fehler }) }));
        expect(lage.sync).toEqual({ art: "drossel", bis: new Date("2026-10-26T12:30:00Z") });
        expect([lage.zuweisen, lage.entfernen]).toEqual([undefined, undefined]);
        expect(lage.spaeter).toBe(true);
        // Ist die Pause vorbei, geht der Sync wieder; der Knopf heißt weiter „Später erneut“, bis ein Erfolg den Fehler löscht.
        const danach = wikiBoxLage(eingabe({ stand: stand({ fehler }), jetzt: Date.parse("2026-10-26T12:30:01Z") }));
        expect(danach.sync).toBeUndefined();
        expect(danach.spaeter).toBe(true);
    });

    it("ein Fehler ohne Pause (das Wiki antwortet nicht) sperrt nichts, der Knopf heißt „Später erneut“", () => {
        const lage = wikiBoxLage(
            eingabe({ stand: stand({ fehler: { am: "2026-10-26T11:59:00Z", code: "verbindung", freiAb: null } }) }),
        );
        expect(lage.sync).toBeUndefined();
        expect(lage.spaeter).toBe(true);
    });

    it("🔴 lokal gibt es keinen Abruf: Der Sync nennt seinen Grund, Zuweisen und Entfernen gehen trotzdem", () => {
        const lage = wikiBoxLage(eingabe({ stand: stand({ moeglich: false, grund: "abruf_gesperrt" }) }));
        expect(lage.sync).toEqual({ art: "sync", grund: "abruf_gesperrt" });
        expect([lage.zuweisen, lage.entfernen]).toEqual([undefined, undefined]);
        expect(lage.syncKnopf).toBe(true);
        const legacy = wikiBoxLage(eingabe({ stand: stand({ moeglich: false, grund: "gehoert_legacy" }) }));
        expect(legacy.sync).toEqual({ art: "sync", grund: "gehoert_legacy" });
    });

    it("läuft ein Sync, sperren Zuweisen und Entfernen, und die Fortschrittsanzeige ersetzt den Sync-Knopf", () => {
        const lage = wikiBoxLage(eingabe({ stand: stand({ laeuft: true }) }));
        expect([lage.zuweisen, lage.entfernen]).toEqual([{ art: "laeuft" }, { art: "laeuft" }]);
        expect(lage.syncKnopf).toBe(false);
    });

    it("während die Box selbst sendet, sperren alle drei", () => {
        const lage = wikiBoxLage(eingabe({ beschaeftigt: true }));
        expect([lage.zuweisen, lage.sync, lage.entfernen]).toEqual(Array(3).fill({ art: "beschaeftigt" }));
    });

    it("ohne Artikel gibt es nur „Zuweisen“: kein Sync-Knopf, nichts zu entfernen", () => {
        const lage = wikiBoxLage(eingabe({ stand: stand({ moeglich: false, grund: "kein_artikel" }, "keiner") }));
        expect(lage).toMatchObject({ artikel: false, syncKnopf: false, zuweisen: undefined });
    });

    it("ohne Recht keine Knöpfe", () => {
        expect(wikiBoxLage(eingabe({ darf: false })).knoepfe).toBe(false);
    });

    it("vor dem ersten Lesen steht noch kein Artikel da", () => {
        const lage = wikiBoxLage(eingabe({ stand: undefined }));
        expect(lage).toMatchObject({ artikel: false, syncKnopf: false });
    });

    it("🔴 eine kaputte Zeit ist keine Pause", () => {
        expect(
            drosselBis(stand({ fehler: { am: "x", code: "http_429", freiAb: "kein Datum" } }), JETZT),
        ).toBeUndefined();
        expect(drosselBis(stand({ fehler: { am: "x", code: "http_429", freiAb: null } }), JETZT)).toBeUndefined();
        expect(drosselBis(undefined, JETZT)).toBeUndefined();
    });
});

function feld(
    id: string,
    name: string,
    eingabe: Parameters<typeof wikiLage>[0],
    folgt: boolean,
    plan: readonly string[] = [id],
): WikiBoxFeld {
    return { id, plan, name, lage: wikiLage(eingabe), folgt };
}

describe("Wiki-Box: der Stand und die Änderungen", () => {
    const gleich = feld("name", "Name", { eigen: "Gareth", wiki: "Gareth", herkunft: "wiki" }, true);
    const neuer = feld("einwohner", "Einwohner", { eigen: "ca. 38.000", wiki: "ca. 41.000", herkunft: "wiki" }, true);
    const eigen = feld("lage", "Lage", { eigen: "Mittelreich", wiki: "Garetien", herkunft: "manual" }, false);
    const ohne = feld("art", "Art", { eigen: "Hauptstadt", wiki: undefined, mitWiki: false }, false);
    const unbekannt = feld("oberhaupt", "Herrscher", { eigen: "Rohaja", wiki: undefined }, false);

    it("aktuell: nichts weicht ab", () => {
        expect(standZeile([gleich])).toEqual({ art: "aktuell", fuellung: "voll" });
    });

    it("🔴 das Wiki ist neuer: ein Feld, das dem Wiki folgt, weicht ab; der Sync würde es ändern", () => {
        expect(standZeile([gleich, neuer, eigen])).toEqual({ art: "neuer", fuellung: "halb" });
        expect(veraltete([gleich, neuer, eigen]).map((f) => f.id)).toEqual(["einwohner"]);
    });

    it("🔴 ein eigener Wert bleibt: „n von m Feldern folgen dem Wiki“ zählt nur Felder mit Gegenstück im Wiki", () => {
        expect(standZeile([gleich, eigen, ohne, unbekannt])).toEqual({
            art: "teil",
            fuellung: "halb",
            folgen: 1,
            von: 2,
        });
        expect(eigene([gleich, eigen, ohne]).map((f) => f.id)).toEqual(["lage"]);
        // Felder ohne Gegenstück oder mit unbekanntem Wiki-Wert sind weder veraltet noch eigen.
        expect(veraltete([ohne, unbekannt])).toEqual([]);
        expect(eigene([ohne, unbekannt])).toEqual([]);
    });

    it("🔴 der Schlüssel zeigt die Vorsilbe „wiki:“ der Gebiete nicht, die Schlüssel der übrigen Arten bleiben", () => {
        expect(schluesselText("wiki:herzogtum-weiden")).toBe("herzogtum-weiden");
        expect(schluesselText("gareth")).toBe("gareth");
        expect(schluesselText("")).toBe("");
    });

    it("die Namen der Felder des Plans werden zu den Namen des Fensters (Ortsgröße heißt im Plan settlement_class)", () => {
        const groesse = feld("subtype", "Ortsgröße", { eigen: "dorf", wiki: "stadt", herkunft: "wiki" }, true, [
            "settlement_class",
        ]);
        expect(feldNamenZu(["name", "settlement_class", "gibtEsNicht"], [gleich, groesse, neuer])).toEqual([
            "Name",
            "Ortsgröße",
        ]);
        expect(feldNamenZu([], [gleich])).toEqual([]);
    });
});

describe("Wiki-Box: weitere Artikel eines Wegs, nur Anzeige (WI-0300; seit WI-0302 bei den Abschnitten geändert)", () => {
    const WEG_ID = "a0000000-0000-4000-8000-000000000009";
    const wurzel = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const box = readFileSync(resolve(wurzel, "apps/web/src/fenster/wiki-box.vue"), "utf8");

    it("🔴 die Zeile steht nur, wo der Stand `weitere` trägt, mit Link ins Wiki, Anteil und dem Satz, wo man sie ändert", () => {
        expect(box).toContain('v-if="stand.weitere !== undefined"');
        for (const kennung of ["wiki-weitere", "wiki-weiterer", "wiki-weitere-satz"])
            expect(box, kennung).toContain("${kennung}-" + kennung);
        expect(box).toContain('t("wikiBox.weitere.satz")');
        expect(box).toContain('t("wikiBox.weitere.anteil"');
        expect(box).toContain('t("wikiBox.weitere.alle")');
    });

    it("🔴 kein Schreibweg mehr in der Box: kein Lösen, kein Hinzufügen, keine Rückfrage, kein Suchmodus „weitere“", () => {
        for (const alt of [
            "wiki-weitere-loesen",
            "wiki-weitere-hinzufuegen",
            "wiki-weitere-frage",
            "weiseWeitere",
            "loeseWeitere",
            "sucheModus",
            "weitererTrefferSperre",
            "ist_hauptartikel",
            "schon_weiterer",
            "kein_weiterer",
        ])
            expect(box, alt).not.toContain(alt);
    });

    it("die Daten der Box kennen nur noch Stand, Suche, Zuweisen, Entfernen und Sync", () => {
        const daten = createWikiBoxDaten(() => Promise.reject(new Error("kein Netz")));
        expect(Object.keys(daten).sort()).toEqual(["entferne", "stand", "suche", "sync", "weise"]);
    });

    it("die Suche eines Wegs fragt an der Route der Weg-Box, mit dem Suchwort", async () => {
        const adressen: string[] = [];
        const daten = createWikiBoxDaten((eingabe) => {
            adressen.push(String(eingabe));
            return Promise.resolve(
                new Response(JSON.stringify({ articles: [] }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                }),
            );
        });
        await daten.suche("weg", WEG_ID, " Gold ", new AbortController().signal);
        expect(adressen).toEqual([`/api/editor/wiki-box/weg/${WEG_ID}/suche?q=Gold`]);
    });
});
