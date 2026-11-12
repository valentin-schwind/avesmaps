import { describe, expect, it } from "vitest";
import { da } from "../src/i18n/da.ts";
import { de } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";
import { es } from "../src/i18n/es.ts";
import { fr } from "../src/i18n/fr.ts";
import { it as itTafel } from "../src/i18n/it.ts";
import { nl } from "../src/i18n/nl.ts";
import { pl } from "../src/i18n/pl.ts";
import { sv } from "../src/i18n/sv.ts";
import { nachtsFreigeben, type FreigabeFortschritt, type FreigabeLauf, type FreigabeSicht } from "@avesmaps3d/shared";
import {
    createFreigabe,
    gleise,
    kurzStand,
    laeuftGerade,
    letzterRueckweg,
    schienenWert,
    schritte,
    sichtbarerLauf,
    sperrSchluessel,
    themaName,
} from "../src/freigabe/freigabe.ts";

/**
 * Der Eintrag „Production“ im Browser (FREIGABE-0001, Stufe 1).
 *
 * 🔴 Der Knopf nennt den Stand, den er gesehen hat: Hat sich die Stage seitdem bewegt, lehnt der Server ab. Die Oberfläche schickt
 * deshalb immer den Commit aus der Sicht mit — und beim Rückweg bewusst keinen, denn der betrifft Production, nicht die Stage.
 */

const sicht = (patch: Partial<FreigabeSicht> = {}): FreigabeSicht => ({
    now: "2026-10-13T15:00:00.000Z",
    datei: {
        schema: 1,
        standAt: "2026-10-13T14:59:00.000Z",
        production: { release: "878c244", commit: "878c244".padEnd(40, "0"), seit: "2026-10-12T21:22:00.000Z" },
        stage: { release: "e2f28dd", commit: "e2f28dd".padEnd(40, "0"), seit: "2026-10-13T14:05:00.000Z" },
        stageGruen: true,
        stagePruefung: "Proben und Journal, 14:08",
        technik: { migrationen: ["0122"], rechte: [], umgebungswerte: [] },
        themen: [
            {
                id: "grundlage",
                name: null,
                satz: null,
                unredigiert: false,
                marken: ["migration"],
                anzahl: 14,
                bis: "3396055",
            },
            {
                id: "WI-0139",
                name: "Neuigkeiten",
                satz: "Ein Satz.",
                unredigiert: false,
                marken: [],
                anzahl: 7,
                bis: "b81d356",
            },
        ],
    },
    sperre: null,
    laeuft: null,
    frueher: [],
    ...patch,
});

describe("Production: was die Oberfläche rechnet", () => {
    it("die Zahl an der Schiene ist die Zahl der Themen; keine, kein Wert", () => {
        expect(schienenWert(sicht())).toBe("2");
        expect(schienenWert(sicht({ datei: null }))).toBeUndefined();
        expect(schienenWert(null)).toBeUndefined();
        // Läuft ein Lauf, steht der halbe Kreis da (WI-0204).
        const laufend = sicht({
            laeuft: { ops: "OPS-000030", art: "release", status: "neu", seit: "2026-10-13T15:00:00.000Z" },
        });
        expect(schienenWert(laufend)).toBe("◐");
    });

    it("🔴 der letzte Rückweg: aus der Datei, und ohne das Feld steht nichts da (WI-0144 §3)", () => {
        // Betreiber 2026-10-14: „ich muss auf der stage im reiter "Production" sehen, dass ein Feature-Release
        // zurückgefahren wurde“. Eine ältere Statusdatei kennt das Feld nicht — das ist kein Fehler.
        expect(letzterRueckweg(sicht())).toBeNull();
        expect(letzterRueckweg(null)).toBeNull();
        expect(letzterRueckweg(sicht({ datei: null }))).toBeNull();
        const mit = sicht();
        const rueckweg = {
            am: "2026-10-14T02:14:00.000Z",
            von: "e2f28dd",
            auf: "878c244",
            durch: "Rondrikan",
            vorgang: "OPS-000142",
        };
        expect(letzterRueckweg({ ...mit, datei: { ...mit.datei!, letzterRueckweg: rueckweg } })).toEqual(rueckweg);
        // Kennt das Werkzeug das Feld, hatte aber keinen Rückweg: `null` steht für „keiner“, nicht für „unbekannt“.
        expect(letzterRueckweg({ ...mit, datei: { ...mit.datei!, letzterRueckweg: null } })).toBeNull();
        // Ohne Person bleibt das Feld `null`; den Satz dafür hat die Sprachtafel.
        expect(
            letzterRueckweg({ ...mit, datei: { ...mit.datei!, letzterRueckweg: { ...rueckweg, durch: null } } })?.durch,
        ).toBeNull();
    });

    it("jede Sperre hat ihren eigenen Satz, und „offen“ hat keinen", () => {
        expect(sperrSchluessel(null)).toBeNull();
        expect(sperrSchluessel("stage_rot")).toBe("admin.production.blocked.stage_rot");
        expect(sperrSchluessel("laeuft")).toBe("admin.production.blocked.laeuft");
    });

    it("🔴 nachts freigeben erst, wenn Claudios Seite nachts ausliefert (WI-0234)", () => {
        const d = sicht().datei!;
        expect(nachtsFreigeben(d)).toBe(false);
        expect(nachtsFreigeben({ ...d, nachts: true })).toBe(true);
        expect(nachtsFreigeben({ ...d, nachts: false })).toBe(false);
        expect(nachtsFreigeben(null)).toBe(false);
    });

    it("🔴 „ungeprüft“ nennt, was fehlt: Claudios Proben oder den Sammellauf; sonst der allgemeine Satz", () => {
        // Hauptorchestrierung 2026-10-19: Der Betreiber las „Claudios Lauf schreibt das Ergebnis“, es fehlte aber der Sammellauf.
        const d = { ...sicht().datei!, stageGruen: null };
        expect(sperrSchluessel("stage_ungeprueft", { ...d, stagePruefung: null })).toBe(
            "admin.production.blocked.proben_aus",
        );
        expect(
            sperrSchluessel("stage_ungeprueft", {
                ...d,
                stagePruefung: "Proben und Journal gruen, 19.10. 09:12; Sammellauf steht aus",
            }),
        ).toBe("admin.production.blocked.sammellauf_aus");
        expect(sperrSchluessel("stage_ungeprueft", { ...d, stagePruefung: "Proben und Journal, 14:08" })).toBe(
            "admin.production.blocked.stage_ungeprueft",
        );
        expect(sperrSchluessel("stage_ungeprueft")).toBe("admin.production.blocked.stage_ungeprueft");
    });

    it("🔴 die Sätze der Freigabe versprechen keine Uhrzeit und kein Nachtfenster — in jeder Sprache (Betreiber 2026-10-24)", () => {
        // Betreiber 2026-10-24: „der nachtmodus soll abgeschafft werden, wenn ich sage, es soll auf production, soll auf production“.
        const tafeln = { de, en, fr, nl, it: itTafel, es, pl, da, sv } as Record<string, Record<string, string>>;
        for (const [sprache, tafel] of Object.entries(tafeln)) {
            const hinweis = tafel["admin.production.nacht.hinweis"]!;
            const geprueft = tafel["admin.production.nacht.hinweisGeprueft"]!;
            const fuss = tafel["admin.foot.productionNacht"]!;
            for (const satz of [hinweis, geprueft, fuss]) {
                expect(satz, `${sprache}: keine Uhrzeit`).not.toContain("04:30");
                expect(satz, `${sprache}: keine Uhrzeit`).not.toContain("07:00");
            }
            expect(hinweis, sprache).not.toBe(geprueft);
            // Die Prüfung ist keine Uhrzeit mehr.
            expect(tafel["admin.production.nacht.pruefungOffen"], sprache).not.toContain("04:30");
            expect(tafel["admin.production.blocked.sammellauf_aus"], sprache).not.toContain("04:30");
        }
        expect(de["admin.production.nacht.pruefungOffen"]).toBe("Vollständige Prüfung beauftragt");
        expect(de["admin.production.blocked.sammellauf_aus"]).toBe(
            "Für diesen Stand fehlt der vollständige Release-Nachweis.",
        );
    });

    it("die Grundlage trägt ihren Namen aus der Sprachtafel, ein Paket seinen eigenen", () => {
        const [grundlage, paket] = sicht().datei!.themen;
        expect(themaName(grundlage!, "Grundlage")).toBe("Grundlage");
        expect(themaName(paket!, "Grundlage")).toBe("Neuigkeiten");
        // Ohne Titel bleibt die Nummer stehen — besser als ein leerer Name.
        expect(themaName({ ...paket!, name: null }, "Grundlage")).toBe("WI-0139");
    });

    it("🔴 die Freigabe schickt den Stand mit, den sie gesehen hat", async () => {
        const gesendet: { url: string; body: Record<string, unknown> }[] = [];
        const freigabe = createFreigabe({
            fetcher: async (url, init) => {
                const text = String(url);
                if (init?.method === "POST") {
                    gesendet.push({ url: text, body: JSON.parse(String(init.body)) as Record<string, unknown> });
                    return new Response(JSON.stringify({ operationId: "x", status: "applied" }), { status: 200 });
                }
                return new Response(JSON.stringify(sicht()), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            },
        });
        await freigabe.laden();
        expect(freigabe.sperre.value).toBeNull();
        await freigabe.nachProduction();
        expect(gesendet[0]?.url).toContain("/release");
        expect(gesendet[0]?.body["commit"]).toBe("e2f28dd".padEnd(40, "0"));
        // 🔴 Der Rückweg schickt KEINEN Stand: Er betrifft Production, nicht die Stage.
        await freigabe.zurueck();
        expect(gesendet[1]?.url).toContain("/rollback");
        expect(gesendet[1]?.body["commit"]).toBeUndefined();
    });

    it("🔴 vom Klick bis zur frischen Sicht steht der Versuch; eine Abweisung trägt ihre Uhrzeit (Vali 2026-10-25)", async () => {
        let beimSenden: string | null = null;
        let status = 409;
        const zuletzt: { freigabe?: ReturnType<typeof createFreigabe> } = {};
        const freigabe = createFreigabe({
            jetzt: () => 7_000,
            fetcher: async (_url, init) => {
                if (init?.method === "POST") {
                    beimSenden = zuletzt.freigabe?.versuch.value ?? null;
                    const body =
                        status === 200
                            ? { operationId: "x", status: "applied" }
                            : { error: { code: "freigabe_stale", message: "x" } };
                    return new Response(JSON.stringify(body), {
                        status,
                        headers: { "content-type": "application/json" },
                    });
                }
                return new Response(JSON.stringify(sicht()), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            },
        });
        zuletzt.freigabe = freigabe;
        await freigabe.laden();
        expect(await freigabe.nachProduction()).toBe(false);
        expect(beimSenden).toBe("release");
        expect(freigabe.versuch.value).toBeNull();
        expect(freigabe.abgewiesenAm.value).toBe(7_000);
        expect(freigabe.problems.value.length).toBeGreaterThan(0);
        status = 200;
        expect(await freigabe.zurueck()).toBe(true);
        expect(beimSenden).toBe("rollback");
        expect(freigabe.versuch.value).toBeNull();
        expect(freigabe.abgewiesenAm.value).toBeNull();
    });

    it("ein Fehler beim Laden sagt es, statt leer dazustehen", async () => {
        const freigabe = createFreigabe({ fetcher: async () => new Response("", { status: 500 }) });
        await freigabe.laden();
        expect(freigabe.fehler.value).toBe(true);
        expect(freigabe.sicht.value).toBeNull();
    });

    it("🔴 eine falsch geformte Antwort zählt wie ein Lesefehler, statt das Fenster beim Zeichnen abzuschießen", async () => {
        const quittung = JSON.stringify({ operationId: "x", status: "applied" });
        const freigabe = createFreigabe({
            fetcher: async () =>
                new Response(quittung, { status: 200, headers: { "content-type": "application/json" } }),
            mitUmgebungen: true,
        });
        await freigabe.laden();
        expect(freigabe.fehler.value).toBe(true);
        expect(freigabe.sicht.value).toBeNull();
        expect(freigabe.umgebungen.value).toBeNull();
    });
});

/** Der Reiter „Umgebungen“ (WI-0204): Gleise, Schritte und was nach dem Ende stehen bleibt. */
describe("Umgebungen: was die Oberfläche rechnet", () => {
    const lauf = (patch: Partial<FreigabeLauf>): FreigabeLauf => ({
        ops: "OPS-000029",
        release: "20261016T181003Z-878c244",
        at: "2026-10-16T18:41:00.000Z",
        wer: "Vali",
        art: "release",
        themen: 0,
        ...patch,
    });
    const fortschritt = (patch: Partial<FreigabeFortschritt>): FreigabeFortschritt => ({
        zustand: "laeuft",
        phase: "migrieren",
        fertig: [
            { phase: "abgeholt", ms: 2000 },
            { phase: "vorbereiten", ms: 5000 },
        ],
        beginn: "2026-10-13T15:00:00.000Z",
        phaseSeit: "2026-10-13T15:00:07.000Z",
        ende: null,
        fehlerCode: null,
        fehler: null,
        ...patch,
    });
    const offenerLauf = { ops: "OPS-000032", art: "release" as const, seit: "2026-10-13T15:00:00.000Z" };

    it("der kurze Stand ist der Commit am Ende der Release-Kennung", () => {
        expect(kurzStand("20261016T181003Z-4850978")).toBe("4850978");
        expect(kurzStand("4850978")).toBe("4850978");
    });

    it("🔴 Gleise: oben der wartende Stand, dann jede Freigabe; die aktuelle trägt Production, ein Rückweg nimmt die jüngste zurück", () => {
        const zeilen = gleise(
            sicht({
                frueher: [
                    lauf({
                        ops: "OPS-000031",
                        art: "rollback",
                        release: "20261016T150003Z-878c244",
                        at: "2026-10-16T20:00:00.000Z",
                    }),
                    lauf({ ops: "OPS-000030", release: "20261016T190012Z-7a1c2e9", at: "2026-10-16T19:10:00.000Z" }),
                    lauf({ ops: "OPS-000029", release: "20261016T150003Z-878c244", at: "2026-10-16T17:00:00.000Z" }),
                ],
            }),
        );
        expect(zeilen.map((zeile) => [zeile.art, zeile.stand, zeile.stage, zeile.production])).toEqual([
            ["wartet", "e2f28dd", "voll", "leer"],
            ["rollback", "878c244", "keiner", "rueckweg"],
            ["release", "7a1c2e9", "voll", "zurueck"],
            ["release", "878c244", "voll", "voll"],
        ]);
        expect(zeilen[2]?.zurueckAm).toBe("2026-10-16T20:00:00.000Z");
        // Production steht auf 878c244: Die Zeile dieser Freigabe ist die aktuelle, nicht die zurückgenommene.
        expect(zeilen.map((zeile) => zeile.aktuell.production)).toEqual([false, false, false, true]);
        expect(zeilen[0]?.aktuell.stage).toBe(true);
    });

    it("während einer Freigabe ist der wartende Stand unterwegs; sind Stage und Production gleich, wartet nichts", () => {
        const laufend = gleise(
            sicht({ laeuft: { ops: "OPS-000032", art: "release", status: "neu", seit: "2026-10-13T15:00:00.000Z" } }),
        );
        expect(laufend[0]).toMatchObject({ art: "wartet", production: "halb", ops: "OPS-000032" });
        const gleich = sicht();
        const datei = { ...gleich.datei!, stage: gleich.datei!.production };
        expect(gleise({ ...gleich, datei }).filter((zeile) => zeile.art === "wartet")).toEqual([]);
    });

    it("🔴 Schritte ohne Meldung des Abholers: Auftrag fertig, Abgeholt wartet, nichts dazwischen erfunden", () => {
        const offen = schritte({ ...offenerLauf, offen: true, fortschritt: null });
        expect(offen.map((schritt) => [schritt.id, schritt.zustand])).toEqual([
            ["auftrag", "fertig"],
            ["abgeholt", "jetzt"],
            ["vorbereiten", "offen"],
            ["migrieren", "offen"],
            ["rechte", "offen"],
            ["umschalten", "offen"],
            ["proben", "offen"],
            ["live", "offen"],
        ]);
        const zu = schritte({ ...offenerLauf, offen: false, fortschritt: null });
        expect(zu.slice(1).every((schritt) => schritt.zustand === "unbekannt")).toBe(true);
    });

    it("Schritte mit Meldung: fertig mit Dauer, die jetzige seit ihrem Beginn, rot an der Stelle, an der es scheiterte", () => {
        const laufend = schritte({ ...offenerLauf, offen: true, fortschritt: fortschritt({}) });
        expect(laufend.slice(0, 5).map((schritt) => [schritt.id, schritt.zustand, schritt.ms])).toEqual([
            ["auftrag", "fertig", null],
            ["abgeholt", "fertig", 2000],
            ["vorbereiten", "fertig", 5000],
            ["migrieren", "jetzt", null],
            ["rechte", "offen", null],
        ]);
        expect(laufend[3]?.seit).toBe("2026-10-13T15:00:07.000Z");
        const rot = schritte({
            ...offenerLauf,
            offen: true,
            fortschritt: fortschritt({ zustand: "rot", fehlerCode: "migrieren_rot" }),
        });
        expect(rot.find((schritt) => schritt.id === "migrieren")?.zustand).toBe("fehler");
        expect(rot.at(-1)?.zustand).toBe("fehler");
    });

    it("🔴 rote Proben nach dem Umschalten: der Rückweg erscheint als Schritt, die Proben stehen rot", () => {
        const phasen = ["abgeholt", "vorbereiten", "migrieren", "rechte", "umschalten", "proben"] as const;
        const f = fortschritt({
            zustand: "rot",
            phase: "zurueck",
            fertig: phasen.map((phase) => ({ phase, ms: 1000 })),
            fehlerCode: "proben_rot",
        });
        const reihe = schritte({ ...offenerLauf, offen: false, fortschritt: f });
        expect(reihe.map((schritt) => schritt.id)).toEqual([
            "auftrag",
            "abgeholt",
            "vorbereiten",
            "migrieren",
            "rechte",
            "umschalten",
            "proben",
            "zurueck",
            "live",
        ]);
        expect(reihe.find((schritt) => schritt.id === "proben")?.zustand).toBe("fehler");
        // Der automatische Rückweg selbst ist gelungen: Er ist der Grund, nicht ein zweiter Fehler.
        expect(reihe.find((schritt) => schritt.id === "zurueck")?.zustand).toBe("fertig");
        // 🪤 Der Vorgang bleibt offen, bis jemand ihn abschließt; gelaufen ist dann trotzdem nichts mehr.
        expect(laeuftGerade({ ...offenerLauf, offen: true, fortschritt: f })).toBe(false);
        expect(laeuftGerade({ ...offenerLauf, offen: true, fortschritt: null })).toBe(true);
        expect(laeuftGerade({ ...offenerLauf, offen: false, fortschritt: null })).toBe(false);
    });

    it("nach dem Ende bleibt der Lauf eine Stunde stehen, bis er ausgeblendet wird; ohne Meldung gar nicht", () => {
        const ende = "2026-10-13T14:50:00.000Z";
        const mit = sicht({
            frueher: [lauf({ ops: "OPS-000030", fortschritt: fortschritt({ zustand: "gruen", ende }) })],
        });
        expect(sichtbarerLauf(mit, null)).toMatchObject({ ops: "OPS-000030", offen: false });
        expect(sichtbarerLauf(mit, "OPS-000030")).toBeNull();
        expect(sichtbarerLauf({ ...mit, now: "2026-10-13T16:00:00.000Z" }, null)).toBeNull();
        expect(sichtbarerLauf(sicht({ frueher: [lauf({ ops: "OPS-000030" })] }), null)).toBeNull();
    });

    it("🔴 die Liste vom Start bleibt nach dem Ende stehen, damit „in Production“ etwas zeigt", async () => {
        let antwort = sicht({
            laeuft: { ops: "OPS-000030", art: "release", status: "neu", seit: "2026-10-13T15:00:00.000Z" },
        });
        const freigabe = createFreigabe({
            fetcher: async () =>
                new Response(JSON.stringify(antwort), { status: 200, headers: { "content-type": "application/json" } }),
            jetzt: () => 1000,
        });
        await freigabe.laden();
        expect(freigabe.imLauf.value?.themen.map((thema) => thema.id)).toEqual(["grundlage", "WI-0139"]);
        expect(freigabe.geladenAm.value).toBe(1000);
        // Nach dem Ende schreibt Claudio die Datei neu: keine Themen mehr. Gemerkt bleibt die Liste des Laufs.
        const leer = sicht();
        antwort = {
            ...leer,
            datei: { ...leer.datei!, themen: [] },
            frueher: [
                lauf({
                    ops: "OPS-000030",
                    fortschritt: fortschritt({ zustand: "gruen", ende: "2026-10-13T14:59:00.000Z" }),
                }),
            ],
        };
        await freigabe.laden();
        expect(freigabe.imLauf.value?.ops).toBe("OPS-000030");
        expect(freigabe.lauf.value).toMatchObject({ ops: "OPS-000030", offen: false });
        freigabe.ausblenden();
        expect(freigabe.lauf.value).toBeNull();
        expect(freigabe.imLauf.value).toBeNull();
    });
});
