import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nextTick, shallowRef } from "vue";
import { describe, expect, it, vi } from "vitest";
import { vorgabeEckeKlasse } from "../src/fenster/fenster-lage.ts";
import { da } from "../src/i18n/da.ts";
import { de } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";
import { es } from "../src/i18n/es.ts";
import { fr } from "../src/i18n/fr.ts";
import { it as itTafel } from "../src/i18n/it.ts";
import { nl } from "../src/i18n/nl.ts";
import { pl } from "../src/i18n/pl.ts";
import { sv } from "../src/i18n/sv.ts";
import { INTERACTION_PRIORITY } from "../src/map/interaction/priorities.ts";
import { createReisebildSteuerung } from "../src/photobox/reisebild-besucher.ts";
import { STELLE_BILD, STELLE_EBENE, STELLE_QUELLE, stelleDaten, stelleEbenen } from "../src/photobox/stelle-layer.ts";

/**
 * „Eigenes Bild hinzufügen“ im Kartenmenü, die Steuerung der Reisebilder und die Stelle auf der Karte (WI-0272 S2b, Aufgabe 12; Vali 2026-10-31: „Außerdem würde ich ‚Bild von hier zeigen‘ zu
 * ‚Eigenes Bild hinzufügen‘ machen“, „wichtig: die photobox erscheint nur im standard-karten-modus - nicht bei den anderen“). Der Browser steht in `e2e/reisebild-einreichen.spec.ts`.
 */

const wurzel = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const lies = (pfad: string): string => readFileSync(join(wurzel, pfad), "utf8");
/** Ein Quelltext ohne Kommentare: Ein Kommentar darf das Verbotene nennen, um es zu begründen. */
const ohneKommentare = (text: string): string =>
    text
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");

const MENUE = "apps/web/src/controls/map-context-menu.vue";
const APP = "apps/web/src/app.vue";

describe("🔴 der Eintrag „Eigenes Bild hinzufügen“ steht nur in der Standardansicht", () => {
    const menue = ohneKommentare(lies(MENUE));

    it("die Aktion und der Eintrag: mit dem gemalten Bild „BildMachen“ (Vali 2026-11-01), nur für die Standardansicht", () => {
        expect(menue).toMatch(/\| "photobox"/);
        expect(menue).toMatch(
            /\{ action: "photobox", label: "ctxmenu\.photobox", icon: `\$\{ICONS\}bildmachen\.webp`, nurStandard: true \}/,
        );
    });

    it("🔴 der Filter blendet ihn aus, solange `standardAnsicht` nicht wahr ist, und lässt alle anderen Einträge, wie sie waren", () => {
        expect(menue).toMatch(/standardAnsicht\?: boolean/);
        expect(menue).toMatch(/entry\.nurStandard !== true \|\| props\.standardAnsicht === true/);
        // Die Einträge davor bleiben unberührt: ihr Filter bleibt der der Reise und der Messung.
        expect(menue).toMatch(/entry\.whileMeasuring !== true \|\| props\.measuring === true/);
    });

    it("der Eintrag steht nach „Hier etwas melden“ (WI §6)", () => {
        const bericht = menue.indexOf('action: "report"');
        const bild = menue.indexOf('action: "photobox"');
        const naechster = menue.indexOf('action: "nearest"');
        expect(bericht).toBeGreaterThan(0);
        expect(bild).toBeGreaterThan(bericht);
        expect(naechster).toBeGreaterThan(bild);
    });

    it("🔴 `app.vue` reicht die Ansicht und öffnet das Formular an der Stelle des Rechtsklicks, ein Ort darunter ist der Bezug", () => {
        const app = ohneKommentare(lies(APP));
        expect(app).toMatch(/:standard-ansicht="mapView === 'standard'"/);
        expect(app).toMatch(/action === "photobox"/);
        // Das Fenster löst sich vorher auf (WI-0235, `nachladen.ts`): `stelle-layer.ts` misst es im nächsten Takt.
        expect(app).toMatch(
            /ladeBauteilVor\(ReisebildBesucher\)\.then\(\(\) => reisebildBesucher\.oeffne\(point, ortAmPunkt\)\)/,
        );
        expect(app).toMatch(/<ReisebildBesucher\b[^>]*:neben-panel="subjects\.slotOpen\.value"/);
        expect(app).toMatch(/installStelleLayer\(map, \{/);
    });

    it("der Wortlaut „Eigenes Bild hinzufügen“ (§12 Frage 3) steht in allen neun Sprachtafeln", () => {
        expect(de["ctxmenu.photobox"]).toBe("Eigenes Bild hinzufügen");
        expect(de["photobox.titel"]).toBe("Eigenes Bild hinzufügen");
        for (const tafel of [en, fr, nl, itTafel, es, pl, da, sv]) {
            expect(tafel["ctxmenu.photobox"]).toBeTruthy();
            expect(tafel["photobox.titel"]).toBeTruthy();
        }
    });
});

describe("die Rangtafel kennt den Besitzer des Klicks im Wählmodus", () => {
    it("🔴 `stelle-waehlen` hat eine eigene Zahl, steht unter `measure` und über `lage-zeigen`", () => {
        const p = INTERACTION_PRIORITY;
        expect(p["stelle-waehlen"]).toBeLessThan(p.measure);
        expect(p["stelle-waehlen"]).toBeGreaterThan(p["lage-zeigen"]);
    });
});

describe("die Vorgaben der Fensterhülle: mittig, im Wählmodus oben in der Mitte (Entwurf 8)", () => {
    it("mitte und oben-mitte sind gelöste Vorgaben, die eine gemerkte Box schlägt; angedockt gilt keine", () => {
        expect(vorgabeEckeKlasse("geloest", undefined, "mitte")).toBe("avm-fenster--mitte");
        expect(vorgabeEckeKlasse("geloest", undefined, "oben-mitte")).toBe("avm-fenster--oben-mitte");
        expect(
            vorgabeEckeKlasse("geloest", { left: 1, top: 2, width: 520, height: 300 }, "oben-mitte"),
        ).toBeUndefined();
        expect(vorgabeEckeKlasse("angedockt", undefined, "oben-mitte")).toBeUndefined();
    });
});

interface Ort {
    id: string;
    name: string;
    typ: string;
    lage: { x: number; y: number };
}

/** Eine Steuerung ohne Netz und ohne den Wirt der Meldungen: Der nächste Ort kommt aus der Hand, das Fenster der Meldungen ist eine Attrappe. */
function steuerung(ort: Promise<Ort | undefined>) {
    const andere = {
        anzeige: shallowRef<unknown>(undefined),
        schliesse: vi.fn(() => {
            andere.anzeige.value = undefined;
        }),
    };
    const frage = vi.fn(() => ort);
    return { s: createReisebildSteuerung({ naechsterOrt: frage, andere }), andere, frage };
}
const GARETH = { id: "00000000-0000-4000-8000-000000000001", name: "Gareth", subtype: "metropole", x: 551.6, y: 533 };

describe("die Steuerung: ein Besucherfenster zur Zeit", () => {
    it("öffnet das Formular an der Stelle, schließt das Fenster der Meldungen und fragt den nächsten Ort", async () => {
        const { s, andere, frage } = steuerung(
            Promise.resolve({ id: GARETH.id, name: "Gareth", typ: "metropole", lage: { x: 551.6, y: 533 } }),
        );
        const lage = { x: 560, y: 540 };
        s.oeffne(lage);
        expect(andere.schliesse).toHaveBeenCalledTimes(1);
        expect(s.anzeige.value).toMatchObject({ art: "formular", nr: 1, stelle: lage });
        // Das Fenster steht immer in der Mitte: Die Anzeige trägt keine Seite mehr.
        expect(s.anzeige.value).not.toHaveProperty("seite");
        expect(s.stelle.value).toBe(lage);
        expect(frage).toHaveBeenCalledWith(lage);
        await Promise.resolve();
        await Promise.resolve();
        expect(s.anzeige.value).toMatchObject({ ort: { name: "Gareth" } });
    });

    it("liegt unter dem Rechtsklick ein Ort, ist er der Bezug und der Server wird nicht gefragt", () => {
        const { s, frage } = steuerung(Promise.resolve(undefined));
        s.oeffne({ x: 551.6, y: 533 }, GARETH);
        expect(frage).not.toHaveBeenCalled();
        expect(s.anzeige.value).toMatchObject({ ort: { id: GARETH.id, name: "Gareth", typ: "metropole" } });
    });

    it("🔴 ein weiterer Rechtsklick setzt nur die Stelle neu, das Formular (seine Nummer) bleibt; „neu“ beginnt ein frisches", () => {
        const { s } = steuerung(Promise.resolve(undefined));
        s.oeffne({ x: 1, y: 2 });
        const nr = s.anzeige.value?.nr;
        s.oeffne({ x: 3, y: 4 });
        expect(s.anzeige.value).toMatchObject({ art: "formular", nr, stelle: { x: 3, y: 4 } });
        s.oeffne({ x: 3, y: 4 }, undefined, { neu: true, vorbelegung: { entstehung: "photo", name: "Alrik" } });
        expect(s.anzeige.value?.nr).toBe((nr ?? 0) + 1);
        expect(s.anzeige.value).toMatchObject({ vorbelegung: { entstehung: "photo", name: "Alrik" } });
    });

    it("🔴 abgeschickt: Die Stelle verschwindet von der Karte, das Formular (die Bestätigung) bleibt stehen; „Noch ein Bild“ beginnt ein frisches", () => {
        const { s } = steuerung(Promise.resolve(undefined));
        s.oeffne({ x: 1, y: 2 });
        const nr = s.anzeige.value?.nr;
        s.markiereAbgesendet();
        expect(s.stelle.value).toBeUndefined();
        expect(s.anzeige.value).toMatchObject({ art: "formular", nr, abgesendet: true });
        s.oeffne({ x: 1, y: 2 }, undefined, { neu: true });
        expect(s.anzeige.value).toMatchObject({ nr: (nr ?? 0) + 1 });
        expect(s.anzeige.value).not.toHaveProperty("abgesendet", true);
        expect(s.stelle.value).toEqual({ x: 1, y: 2 });
    });

    it("🔴 abgeschickt, dann ein weiterer Rechtsklick (ohne „neu“): ein frisches Formular an der neuen Stelle, mit Symbol und eigener Nummer, ohne die alte Bestätigung", async () => {
        const { s, frage } = steuerung(Promise.resolve(undefined));
        s.oeffne({ x: 1, y: 2 }, undefined, { vorbelegung: { name: "Alrik" } });
        const nr = s.anzeige.value?.nr ?? 0;
        s.markiereAbgesendet();
        expect(s.stelle.value).toBeUndefined();

        s.oeffne({ x: 30, y: 40 });
        expect(s.anzeige.value).toMatchObject({
            art: "formular",
            nr: nr + 1,
            stelle: { x: 30, y: 40 },
        });
        expect(s.anzeige.value).not.toHaveProperty("abgesendet", true);
        expect(s.anzeige.value).not.toHaveProperty("vorbelegung.name");
        // Das Symbol steht an der neuen Stelle (die Karte zeichnet `stelle`), und der nächste Ort wird für sie gefragt.
        expect(s.stelle.value).toEqual({ x: 30, y: 40 });
        expect(frage).toHaveBeenLastCalledWith({ x: 30, y: 40 });
        await Promise.resolve();
    });

    it("der nächste Ort einer überholten Stelle gilt nicht mehr", async () => {
        let antworte: (ort: Ort) => void = () => undefined;
        const spaet = new Promise<Ort | undefined>((fertig) => {
            antworte = fertig;
        });
        const { s } = steuerung(spaet);
        s.oeffne({ x: 1, y: 2 });
        s.oeffne({ x: 9, y: 9 }, GARETH);
        antworte({ id: "x", name: "Zu spät", typ: "dorf", lage: { x: 1, y: 2 } });
        await Promise.resolve();
        await Promise.resolve();
        expect(s.anzeige.value).toMatchObject({ ort: { name: "Gareth" } });
    });

    it("Stelle ändern: der Wählmodus läuft, der Klick setzt die Stelle und beendet ihn; Esc beendet ihn, ohne die Stelle zu ändern", () => {
        const { s } = steuerung(Promise.resolve(undefined));
        const alt = { x: 1, y: 2 };
        s.oeffne(alt);
        s.starteWahl();
        expect(s.waehlen.value).toBe(true);
        s.beendeWahl();
        expect(s.waehlen.value).toBe(false);
        expect(s.stelle.value).toBe(alt);
        s.starteWahl();
        s.setzeStelle({ x: 7, y: 8 });
        expect(s.waehlen.value).toBe(false);
        expect(s.stelle.value).toEqual({ x: 7, y: 8 });
    });

    it("🔴 ein Fenster der Meldungen schließt das der Reisebilder", async () => {
        const { s, andere } = steuerung(Promise.resolve(undefined));
        s.oeffne({ x: 1, y: 2 });
        andere.anzeige.value = { art: "meldung" };
        await nextTick();
        expect(s.anzeige.value).toBeUndefined();
        expect(s.stelle.value).toBeUndefined();
    });

    it("die Statusseite: ein verstümmelter Schlüssel ist `null`, ein gültiger bleibt", () => {
        const { s } = steuerung(Promise.resolve(undefined));
        s.oeffneStatus("zu-kurz");
        expect(s.anzeige.value).toMatchObject({ art: "status", schluessel: null });
        const gut = "A".repeat(43);
        s.oeffneStatus(gut);
        expect(s.anzeige.value).toMatchObject({ art: "status", schluessel: gut });
        expect(s.stelle.value).toBeUndefined();
    });

    it("lösen und andocken: angedockt meldet die Steuerung, solange ein Fenster offen ist", () => {
        const { s } = steuerung(Promise.resolve(undefined));
        expect(s.angedockt.value).toBe(false);
        s.oeffne({ x: 1, y: 2 });
        s.setzeLage("angedockt");
        expect(s.angedockt.value).toBe(true);
        s.schliesse();
        expect(s.angedockt.value).toBe(false);
    });

    describe("🔴 die gezogene Größe gilt nur für die Art Fenster, in der sie gezogen wurde (Stage-Fund: das Statusfenster war so hoch wie das Formular)", () => {
        const BOX = { left: 300, top: 40, width: 640, height: 760 };
        const STATUS = "A".repeat(43);

        it("Formular gezogen, dann „Stand ansehen“: die Box ist weg, die Lage bleibt", () => {
            const { s } = steuerung(Promise.resolve(undefined));
            s.oeffne({ x: 1, y: 2 });
            s.setzeBox(BOX);
            expect(s.fenster.value).toEqual({ lage: "geloest", box: BOX });
            s.markiereAbgesendet();
            s.oeffneStatus(STATUS);
            expect(s.fenster.value).toEqual({ lage: "geloest" });
            expect(s.fenster.value.box).toBeUndefined();
        });

        it("angedockt bleibt angedockt, wenn die Anzeige wechselt", () => {
            const { s } = steuerung(Promise.resolve(undefined));
            s.oeffne({ x: 1, y: 2 });
            s.setzeLage("angedockt", BOX);
            s.oeffneStatus(STATUS);
            expect(s.fenster.value).toEqual({ lage: "angedockt" });
        });

        it("die Statusseite gezogen, dann ein Formular („Neues Bild von dieser Stelle“): ebenso", () => {
            const { s } = steuerung(Promise.resolve(undefined));
            s.oeffneStatus(STATUS);
            s.setzeBox(BOX);
            s.oeffne({ x: 3, y: 4 }, undefined, { neu: true });
            expect(s.fenster.value).toEqual({ lage: "geloest" });
        });

        it("auch über ein Schließen hinweg: das Formular gezogen und geschlossen, die Statusseite über den Link geöffnet", () => {
            const { s } = steuerung(Promise.resolve(undefined));
            s.oeffne({ x: 1, y: 2 });
            s.setzeBox(BOX);
            s.schliesse();
            s.oeffneStatus(STATUS);
            expect(s.fenster.value.box).toBeUndefined();
        });

        it("bei gleicher Art bleibt die gezogene Größe: ein weiterer Rechtsklick, „Noch ein Bild von hier“, ein weiterer Link", () => {
            const { s } = steuerung(Promise.resolve(undefined));
            s.oeffne({ x: 1, y: 2 });
            s.setzeBox(BOX);
            s.oeffne({ x: 5, y: 6 });
            expect(s.fenster.value.box).toEqual(BOX);
            s.markiereAbgesendet();
            s.oeffne({ x: 5, y: 6 }, undefined, { neu: true });
            expect(s.fenster.value.box).toEqual(BOX);

            s.oeffneStatus(STATUS);
            expect(s.fenster.value.box).toBeUndefined();
            const gezogen = { left: 10, top: 20, width: 700, height: 500 };
            s.setzeBox(gezogen);
            s.oeffneStatus("B".repeat(43));
            expect(s.fenster.value.box).toEqual(gezogen);
        });

        it("ohne gezogene Box ändert der Wechsel nichts", () => {
            const { s } = steuerung(Promise.resolve(undefined));
            s.oeffne({ x: 1, y: 2 });
            s.oeffneStatus(STATUS);
            expect(s.fenster.value).toEqual({ lage: "geloest" });
        });
    });

    describe("🔴 „Auf der Karte zeigen“ der Statusseite zeigt Platzhalter und Linie wie das Formular (Stage-Fund)", () => {
        const STATUS = "A".repeat(43);
        const STELLE = { x: 200, y: 300 };

        it("die Statusseite zeigt die Stelle: `stelle` (Symbol und Bildschirmpunkt der Linie) ist sie, die Kamera fliegt hin", () => {
            const { s } = steuerung(Promise.resolve(undefined));
            const zeige = vi.fn();
            s.verbinde(zeige);
            s.oeffneStatus(STATUS);
            expect(s.stelle.value).toBeUndefined();
            expect(s.gezeigt.value).toBeUndefined();
            s.zeigeAufKarte(STELLE);
            expect(s.stelle.value).toBe(STELLE);
            expect(s.gezeigt.value).toMatchObject({ lage: STELLE });
            expect(zeige).toHaveBeenCalledWith(STELLE);
        });

        it("jedes Auslösen zählt eine Nummer weiter (die Linie zeichnet sich jedes Mal einmal)", () => {
            const { s } = steuerung(Promise.resolve(undefined));
            s.oeffneStatus(STATUS);
            s.zeigeAufKarte(STELLE);
            const erste = s.gezeigt.value!.nr;
            s.zeigeAufKarte(STELLE);
            expect(s.gezeigt.value!.nr).toBeGreaterThan(erste);
        });

        it("Platzhalter und Linie enden mit der Statusseite: Schließen, ein anderer Link, ein Formular, ein Fenster der Meldungen", () => {
            const { s, andere } = steuerung(Promise.resolve(undefined));
            s.oeffneStatus(STATUS);
            s.zeigeAufKarte(STELLE);
            s.schliesse();
            expect(s.stelle.value).toBeUndefined();
            expect(s.gezeigt.value).toBeUndefined();

            s.oeffneStatus(STATUS);
            s.zeigeAufKarte(STELLE);
            s.oeffneStatus("B".repeat(43));
            expect(s.gezeigt.value).toBeUndefined();
            expect(s.stelle.value).toBeUndefined();

            s.zeigeAufKarte(STELLE);
            s.oeffne({ x: 3, y: 4 }, undefined, { neu: true });
            expect(s.gezeigt.value).toBeUndefined();
            expect(s.stelle.value).toEqual({ x: 3, y: 4 });

            s.oeffneStatus(STATUS);
            s.zeigeAufKarte(STELLE);
            andere.anzeige.value = { art: "meldung" };
            return Promise.resolve().then(() => {
                expect(s.anzeige.value).toBeUndefined();
                expect(s.stelle.value).toBeUndefined();
            });
        });

        it("ohne Statusseite zeigt „zeigen“ nur die Kamera: das Formular behält seine eigene Stelle", () => {
            const { s } = steuerung(Promise.resolve(undefined));
            const zeige = vi.fn();
            s.verbinde(zeige);
            s.oeffne({ x: 1, y: 2 });
            s.zeigeAufKarte(STELLE);
            expect(s.gezeigt.value).toBeUndefined();
            expect(s.stelle.value).toEqual({ x: 1, y: 2 });
            expect(zeige).toHaveBeenCalledWith(STELLE);
        });

        it("der Wirt hängt die Linie an `linieAn` und findet beide Fenster der Reisebilder", () => {
            const wirt = ohneKommentare(lies("apps/web/src/photobox/reisebild-besucher.vue"));
            expect(wirt).toContain("aktiv: () => linieAn.value");
            expect(wirt).toContain('v-if="linie !== undefined && linieAn"');
            expect(wirt).toContain('[data-testid="${REISEBILD_FENSTER}"], [data-testid="${REISEBILD_STATUS_FENSTER}"]');
            expect(wirt).toContain('jetzt?.art === "status" && steuerung.gezeigt.value !== undefined');
        });
    });

    it("„Auf der Karte zeigen“ geht an den, der sich eingehängt hat", () => {
        const { s } = steuerung(Promise.resolve(undefined));
        const zeige = vi.fn();
        const weg = s.verbinde(zeige);
        s.zeigeAufKarte({ x: 5, y: 6 });
        expect(zeige).toHaveBeenCalledWith({ x: 5, y: 6 });
        weg();
        s.zeigeAufKarte({ x: 7, y: 8 });
        expect(zeige).toHaveBeenCalledTimes(1);
    });
});

describe("die Stelle auf der Karte", () => {
    it("ein Punkt an der Stelle in Renderkoordinaten, ohne Stelle nichts", () => {
        expect(stelleDaten(undefined).features).toEqual([]);
        const daten = stelleDaten({ x: 512, y: 512 });
        expect(daten.features).toHaveLength(1);
        expect(daten.features[0]?.geometry.type).toBe("Point");
        expect(daten.features[0]?.geometry.coordinates).toHaveLength(2);
    });

    it("eine Ebene für das Symbol, nicht anklickbar durch den Koordinator (kein Name in seinen Listen) und ohne Kollision", () => {
        const [ebene] = stelleEbenen();
        expect(stelleEbenen()).toHaveLength(1);
        expect(ebene).toMatchObject({ id: STELLE_EBENE, type: "symbol", source: STELLE_QUELLE });
        expect(ebene?.layout).toMatchObject({
            "icon-image": STELLE_BILD,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
        });
    });
});
