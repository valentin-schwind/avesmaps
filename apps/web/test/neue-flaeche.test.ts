import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, markRaw, ref } from "vue";
import type { LandscapeSelection, MapView } from "@avesmaps3d/shared";
import {
    ANLEGEN_ANFANG,
    anlegenStand,
    anlegenStart,
    anlegenZiele,
    setze,
    type AnlegenEingabe,
    type AnlegenEntwurf,
    type AnlegenModus,
    type AnlegenPunkt,
} from "../src/map/geometrie/anlegen";
import { FLAECHE_ANLEGEN, GEBIET_ANLEGEN } from "../src/map/geometrie/arten";
import { belegeGeometrie } from "../src/map/geometrie/besitzer";
import type { Punkt, Ziel } from "../src/map/geometrie/geometrie";
import {
    createNeueFlaeche,
    type NeueFlaecheAndockung,
    type NeueFlaecheAnsicht,
    type NeueFlaecheErgebnis,
} from "../src/map/geometrie/neue-flaeche";
import { ansichtDerSeite, gezeichnet } from "../src/map/geometrie/neue-flaeche-anbindung";
import type { MessageKey } from "../src/i18n/i18n";

/**
 * „Neue Fläche“ (C3; EDIT-0003 T47, abgenommen 2026-10-18: „Nach dem Zeichnen / Fertig: bleiben · Abbruch: zurück“) mit einer
 * Testandockung gegen eine gestellte Karte. Problemfälle: Nach „Fertig“ springt die Karte in die Ansicht von vorher; nach einem Abbruch
 * bleibt sie in der Ansicht der Art; während des Zeichnens wechselt die Ansicht; „Fertig“ schreibt mehr als EINE Operation oder den Ring
 * geschlossen; nach einer Ablehnung ist der Entwurf weg; die Andockung liest an der ersten Ecke, bevor die Karte in ihrer Ansicht
 * gezeichnet ist; ein Grund der Andockung oder ein laufender Modus startet trotzdem.
 */

const ECKE_NACHBAR: Ziel = { art: "ecke", at: { x: 10, y: 10 }, objekt: "nachbar", name: "Nachbarland" };
/** Ein Bauteil der Art für die Leiste, wie der Untergrund-Regler der Derographie. */
const ZUSATZ = defineComponent({ name: "ProbeZusatz", render: () => h("span", "Untergrund") });

function aufbau(
    optionen: {
        ergebnis?: () => NeueFlaecheErgebnis | Promise<NeueFlaecheErgebnis>;
        darf?: MessageKey;
        grund?: MessageKey;
        vorher?: NeueFlaecheAnsicht;
    } = {},
) {
    const reihenfolge: string[] = [];
    let ansicht: NeueFlaecheAnsicht = optionen.vorher ?? { view: "standard", layer: "alle" };
    let gesperrt = false;
    let entwurf: AnlegenEntwurf = anlegenStart();
    let eingabe: AnlegenEingabe | undefined;
    const geschrieben: { ring: readonly Punkt[]; operationId: string }[] = [];
    const modus = {
        zurueck: vi.fn(),
        wieder: vi.fn(),
        verwerfen: vi.fn(),
        fertig: vi.fn(),
        sperre: vi.fn<(an: boolean) => void>(),
        aktualisiere: vi.fn(),
        entwurf: () => entwurf,
        aus: vi.fn(),
    } satisfies AnlegenModus;
    /** Für welche Andockung die Seite ihren Grund nennen sollte (die Rechte hängen am Fach, WI-0279). */
    const gefragt: string[] = [];
    const andockung = {
        id: "probe",
        art: FLAECHE_ANLEGEN,
        ansicht: { view: "landscapes", layer: "vegetation" },
        titel: "neueFlaeche.titel",
        zusatz: markRaw(ZUSATZ),
        darf: vi.fn((): MessageKey | undefined => optionen.darf),
        objekt: vi.fn((ecke: Punkt | undefined) => {
            reihenfolge.push("objekt");
            return ecke === undefined ? undefined : `bei ${String(ecke.x)}/${String(ecke.y)}`;
        }),
        ziele: vi.fn(async () => {
            reihenfolge.push("ziele");
            return [ECKE_NACHBAR];
        }),
        schreibe: vi.fn(async (ring: readonly Punkt[], operationId: string) => {
            geschrieben.push({ ring, operationId });
            return (
                optionen.ergebnis?.() ?? {
                    ok: true as const,
                    publicId: "neu-1",
                    name: "Neue Fläche (1)",
                    mapRevision: 9,
                }
            );
        }),
        geoeffnet: vi.fn(),
    } satisfies NeueFlaecheAndockung;
    const geaendert = vi.fn();
    // Ein Kartenpunkt am Schirm: zehn Bildpunkte je Einheit.
    const schirm = (p: Punkt) => ({ x: p.x * 10, y: p.y * 10 });
    const neueFlaeche = createNeueFlaeche({
        fangradius: () => 10,
        neueKennung: () => "op-1",
        grund: (fuer) => {
            gefragt.push(fuer.id);
            return optionen.grund;
        },
        karte: {
            ein: vi.fn((e: AnlegenEingabe) => {
                eingabe = e;
                entwurf = anlegenStart(e.anfang);
                return modus;
            }),
            sichtbar: () => ({ x0: 0, y0: 0, x1: 400, y1: 300 }),
            schirm,
            ansicht: () => ansicht,
            stelle: vi.fn((neu: NeueFlaecheAnsicht) => {
                reihenfolge.push(`stelle ${neu.view}`);
                ansicht = { view: neu.view, layer: neu.layer ?? ansicht.layer };
            }),
            sperreAnsicht: vi.fn((an: boolean) => {
                reihenfolge.push(an ? "sperre" : "frei");
                gesperrt = an;
            }),
            gezeichnet: vi.fn(async () => {
                reihenfolge.push("gezeichnet");
            }),
            geaendert,
        },
    });
    /** Wie der Modus: Ecken setzen und den Stand melden. */
    const setzeEcken = (...punkte: Punkt[]): void => {
        const neu: AnlegenPunkt[] = punkte.map((at) => ({ at, ziel: undefined }));
        entwurf = { ...entwurf, punkte: [...entwurf.punkte, ...neu] };
        eingabe?.stand(anlegenStand(FLAECHE_ANLEGEN, entwurf));
    };
    return {
        neueFlaeche,
        andockung,
        modus,
        geschrieben,
        geaendert,
        reihenfolge,
        gefragt,
        setzeEcken,
        ansicht: () => ansicht,
        gesperrt: () => gesperrt,
        eingabe: () => eingabe,
    };
}

describe("Neue Fläche (C3): der Ablauf", () => {
    it("🔴 Start: Ansicht der Art, gesperrt, erst gezeichnet, dann Ziele und die erste Ecke am Klickpunkt (eingerastet)", async () => {
        const t = aufbau();
        const start = await t.neueFlaeche.starte({ andockung: t.andockung, anfang: { x: 10.5, y: 10 } });
        expect(start).toBe("laeuft");
        expect(t.ansicht()).toEqual({ view: "landscapes", layer: "vegetation" });
        expect(t.gesperrt()).toBe(true);
        // Gelesen wird erst, wenn die Karte in der Ansicht der Art gezeichnet ist.
        expect(t.reihenfolge.slice(0, 5)).toEqual(["stelle landscapes", "sperre", "gezeichnet", "ziele", "objekt"]);
        // Fünf Bildpunkte neben der Ecke des Nachbarn, im Fangradius: Die erste Ecke liegt auf ihr.
        expect(t.eingabe()?.anfang).toEqual({ at: { x: 10, y: 10 }, ziel: ECKE_NACHBAR });
        expect(t.eingabe()?.art).toBe(FLAECHE_ANLEGEN);
        expect(t.neueFlaeche.laufend.value).toMatchObject({
            phase: "bereit",
            andockung: "probe",
            titel: "neueFlaeche.titel",
            objekt: "bei 10/10",
        });
        // Das Bauteil der Andockung für den Platz #zusatz der Leiste; ohne Bauteil steht dort nichts.
        expect(t.neueFlaeche.laufend.value?.zusatz).toBe(ZUSATZ);
    });

    it("🔴 „Fertig“: EINE Operation mit dem offenen Ring, danach BLEIBT die Ansicht, das Fenster öffnet die neue Fläche", async () => {
        const t = aufbau();
        await t.neueFlaeche.starte({ andockung: t.andockung, anfang: { x: 50, y: 50 } });
        t.setzeEcken({ x: 60, y: 50 }, { x: 60, y: 60 });
        t.eingabe()?.fertig(t.modus.entwurf().punkte);
        expect(t.modus.sperre).toHaveBeenCalledWith(true);
        await vi.waitFor(() => expect(t.neueFlaeche.laufend.value).toBeUndefined());
        expect(t.geschrieben).toEqual([
            {
                ring: [
                    { x: 50, y: 50 },
                    { x: 60, y: 50 },
                    { x: 60, y: 60 },
                ],
                operationId: "op-1",
            },
        ]);
        expect(t.andockung.schreibe).toHaveBeenCalledTimes(1);
        expect(t.modus.aus).toHaveBeenCalledTimes(1);
        expect(t.ansicht()).toEqual({ view: "landscapes", layer: "vegetation" });
        expect(t.gesperrt()).toBe(false);
        expect(t.geaendert).toHaveBeenCalledWith(9);
        expect(t.andockung.geoeffnet).toHaveBeenCalledWith({ publicId: "neu-1", name: "Neue Fläche (1)" });
        expect(t.neueFlaeche.meldung.value).toEqual({ art: "gespeichert", publicId: "neu-1", name: "Neue Fläche (1)" });
    });

    it("🔴 Abbruch: Esc ohne Kante endet und stellt Ansicht und Ebene von vorher her; nichts geschrieben", async () => {
        const t = aufbau({ vorher: { view: "political", layer: "derographisch" } });
        await t.neueFlaeche.starte({ andockung: t.andockung, anfang: { x: 50, y: 50 } });
        expect(t.neueFlaeche.abbrechen()).toBe(true);
        expect(t.neueFlaeche.laufend.value).toBeUndefined();
        expect(t.ansicht()).toEqual({ view: "political", layer: "derographisch" });
        expect(t.gesperrt()).toBe(false);
        // Erst frei, dann zurück: Gesperrt nähme die Ansicht den Wechsel sonst gleich wieder zurück.
        expect(t.reihenfolge.slice(-2)).toEqual(["frei", "stelle political"]);
        expect(t.andockung.schreibe).not.toHaveBeenCalled();
        expect(t.neueFlaeche.abbrechen()).toBe(false);
    });

    it("🔴 Abbruch mit Kanten: das erste Esc fragt, „Weiter bearbeiten“ zeichnet weiter, das zweite Esc verwirft und geht zurück", async () => {
        const t = aufbau();
        await t.neueFlaeche.starte({ andockung: t.andockung, anfang: { x: 50, y: 50 } });
        t.setzeEcken({ x: 60, y: 50 });
        expect(t.neueFlaeche.abbrechen()).toBe(true);
        expect(t.neueFlaeche.laufend.value?.frage).toBe(true);
        t.neueFlaeche.antworte(false);
        expect(t.neueFlaeche.laufend.value?.frage).toBe(false);
        expect(t.ansicht().view).toBe("landscapes");
        t.neueFlaeche.abbrechen();
        t.neueFlaeche.abbrechen();
        expect(t.neueFlaeche.laufend.value).toBeUndefined();
        expect(t.neueFlaeche.meldung.value).toEqual({ art: "verworfen" });
        expect(t.ansicht()).toEqual({ view: "standard", layer: "alle" });
    });

    it("„Verwerfen“ auf die Frage geht zurück; „Verwerfen“ in der Leiste stellt nur den Beginn her, Modus und Ansicht bleiben", async () => {
        const t = aufbau();
        await t.neueFlaeche.starte({ andockung: t.andockung, anfang: { x: 50, y: 50 } });
        t.setzeEcken({ x: 60, y: 50 });
        t.neueFlaeche.verwerfen();
        expect(t.modus.verwerfen).toHaveBeenCalledTimes(1);
        expect(t.neueFlaeche.laufend.value).toBeDefined();
        expect(t.ansicht().view).toBe("landscapes");
        t.neueFlaeche.abbrechen();
        t.neueFlaeche.antworte(true);
        expect(t.neueFlaeche.laufend.value).toBeUndefined();
        expect(t.ansicht().view).toBe("standard");
    });

    it("🔴 Ablehnung: der Entwurf bleibt, der Satz des Servers steht da; ein Serverfehler und keine Antwort ebenso", async () => {
        const faelle: [() => NeueFlaecheErgebnis | Promise<NeueFlaecheErgebnis>, unknown][] = [
            [
                () => ({ ok: false, satz: "Die Fläche schneidet sich selbst." }),
                { art: "abgelehnt", satz: "Die Fläche schneidet sich selbst." },
            ],
            [() => ({ ok: false, status: 503 }), { art: "serverfehler", status: 503 }],
            [() => Promise.reject(new Error("weg")), { art: "serverfehler", status: 0 }],
        ];
        for (const [ergebnis, meldung] of faelle) {
            const t = aufbau({ ergebnis });
            await t.neueFlaeche.starte({ andockung: t.andockung, anfang: { x: 50, y: 50 } });
            t.setzeEcken({ x: 60, y: 50 }, { x: 60, y: 60 });
            t.eingabe()?.fertig(t.modus.entwurf().punkte);
            await vi.waitFor(() => expect(t.neueFlaeche.meldung.value).toEqual(meldung));
            expect(t.neueFlaeche.laufend.value?.phase).toBe("bereit");
            expect(t.modus.sperre).toHaveBeenLastCalledWith(false);
            expect(t.modus.aus).not.toHaveBeenCalled();
            expect(t.ansicht().view).toBe("landscapes");
            expect(t.andockung.geoeffnet).not.toHaveBeenCalled();
            t.neueFlaeche.destroy();
        }
    });

    it("🔴 ein Grund der Seite, der Andockung oder ein laufender Modus: nichts geschaltet, `starte` nennt ihn", async () => {
        const seite = aufbau({ grund: "ortseditor.handgriff.grund.recht" });
        expect(await seite.neueFlaeche.starte({ andockung: seite.andockung })).toBe("ortseditor.handgriff.grund.recht");
        // Die Seite nennt den Grund für DIESE Andockung: Eine Sprache zeichnet, wer Sprachen schreibt, nicht, wer die Derographie formt (WI-0279, Linguist).
        expect(seite.gefragt).toEqual(["probe"]);
        const art = aufbau({ darf: "editorPanel.spaeter.satz" });
        expect(await art.neueFlaeche.starte({ andockung: art.andockung })).toBe("editorPanel.spaeter.satz");
        const belegung = belegeGeometrie();
        const belegt = aufbau();
        expect(await belegt.neueFlaeche.starte({ andockung: belegt.andockung })).toBe("geometrie.belegt");
        belegung?.frei();
        for (const t of [seite, art, belegt]) {
            expect(t.ansicht()).toEqual({ view: "standard", layer: "alle" });
            expect(t.reihenfolge).toEqual([]);
            expect(t.neueFlaeche.laufend.value).toBeUndefined();
        }
    });

    it("ohne Klickpunkt setzt der erste Klick die erste Ecke; die Zeile der Leiste folgt ihr, auch nach ↶", async () => {
        const t = aufbau();
        await t.neueFlaeche.starte({ andockung: t.andockung });
        expect(t.eingabe()?.anfang).toBeUndefined();
        expect(t.neueFlaeche.laufend.value?.objekt).toBeUndefined();
        t.setzeEcken({ x: 20, y: 30 });
        expect(t.neueFlaeche.laufend.value?.objekt).toBe("bei 20/30");
        t.setzeEcken({ x: 30, y: 30 });
        // Einmal beim Start ohne Ecke, einmal mit der ersten; die zweite Ecke fragt nicht.
        expect(t.andockung.objekt).toHaveBeenCalledTimes(2);
    });

    it("die Ziele kommen neu, wenn die Karte zur Ruhe kommt, um die letzte Ecke", async () => {
        const t = aufbau();
        await t.neueFlaeche.starte({ andockung: t.andockung, anfang: { x: 50, y: 50 } });
        t.setzeEcken({ x: 60, y: 50 });
        await t.neueFlaeche.ladeZiele();
        expect(t.andockung.ziele).toHaveBeenLastCalledWith(
            { x0: 0, y0: 0, x1: 400, y1: 300 },
            { x: 60, y: 50 },
            expect.any(AbortSignal),
        );
        expect(t.modus.aktualisiere).toHaveBeenCalledTimes(1);
    });

    it("Esc während des Schreibens beendet den Modus, die Ansicht bleibt; die späte Quittung bringt die Karte trotzdem", async () => {
        let antworte: (e: NeueFlaecheErgebnis) => void = () => undefined;
        const spaet = new Promise<NeueFlaecheErgebnis>((r) => (antworte = r));
        const t = aufbau({ ergebnis: () => spaet });
        await t.neueFlaeche.starte({ andockung: t.andockung, anfang: { x: 50, y: 50 } });
        t.setzeEcken({ x: 60, y: 50 }, { x: 60, y: 60 });
        t.eingabe()?.fertig(t.modus.entwurf().punkte);
        expect(t.neueFlaeche.laufend.value?.phase).toBe("speichert");
        expect(t.neueFlaeche.abbrechen()).toBe(true);
        expect(t.neueFlaeche.laufend.value).toBeUndefined();
        expect(t.ansicht().view).toBe("landscapes");
        antworte({ ok: true, publicId: "neu-2", name: "Spät", mapRevision: 11 });
        await vi.waitFor(() => expect(t.geaendert).toHaveBeenCalledWith(11));
        expect(t.andockung.geoeffnet).not.toHaveBeenCalled();
    });
});

describe("Neue Fläche (C3): die Arten", () => {
    const ring = (n: number): AnlegenEntwurf => ({
        punkte: Array.from({ length: n }, (_, i) => ({ at: { x: i * 10, y: (i % 2) * 10 }, ziel: undefined })),
        wieder: [],
        fest: 0,
    });

    it("🔴 der eigene erste Punkt schließt erst ab drei Ecken, und ein Klick dort beendet", () => {
        expect(anlegenZiele(FLAECHE_ANLEGEN, ring(2), []).some((z) => z.objekt === ANLEGEN_ANFANG)).toBe(false);
        const ziele = anlegenZiele(FLAECHE_ANLEGEN, ring(3), []);
        const anfang = ziele.find((z) => z.objekt === ANLEGEN_ANFANG);
        expect(anfang?.at).toEqual({ x: 0, y: 0 });
        const geklickt = setze(FLAECHE_ANLEGEN, ring(3), { x: 0, y: 0 }, { ziel: anfang!, at: anfang!.at, abstand: 0 });
        expect(geklickt).toEqual({ entwurf: ring(3), beenden: true });
    });

    it("an Ecken und Kanten anderer Flächen rastet ein Klick nur ein; „Fertig“ erst ab drei Ecken", () => {
        expect(FLAECHE_ANLEGEN.ziele("anfang")).toEqual(["ecke", "kante"]);
        expect(FLAECHE_ANLEGEN.amZiel(ECKE_NACHBAR, [{ x: 0, y: 0 }])).toBe("einrasten");
        expect(
            FLAECHE_ANLEGEN.pruefe([
                { x: 0, y: 0 },
                { x: 1, y: 0 },
            ]),
        ).toBe("zuWenig");
        expect(
            FLAECHE_ANLEGEN.pruefe([
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 1, y: 1 },
            ]),
        ).toBeUndefined();
        expect(
            GEBIET_ANLEGEN.pruefe([
                { x: 0, y: 0 },
                { x: 1, y: 0 },
            ]),
        ).toBe("zuWenig");
    });

    it("die Fläche zeichnet gerundet wie die Karte, das Gebiet eckig wie die Karte", () => {
        const geschlossen = [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
            { x: 0, y: 0 },
        ];
        expect(GEBIET_ANLEGEN.rundung(geschlossen)).toEqual(geschlossen);
        expect(FLAECHE_ANLEGEN.rundung(geschlossen).length).toBeGreaterThan(geschlossen.length);
        expect(GEBIET_ANLEGEN.id).toBe("gebiet");
        expect(FLAECHE_ANLEGEN.teilart).toBe("ring");
    });
});

describe("Neue Fläche (C3): die Ansicht der Seite", () => {
    it("🔴 gesperrt nimmt jeder Wechsel von außen sich sofort zurück und meldet es; frei wechselt sie wieder", () => {
        const view = ref<MapView>("standard");
        const layer = ref<LandscapeSelection>("alle");
        const gemeldet = vi.fn();
        const seite = ansichtDerSeite(view, layer, gemeldet);
        seite.stelle({ view: "landscapes", layer: "topographie" });
        seite.sperreAnsicht(true);
        view.value = "political";
        expect(view.value).toBe("landscapes");
        layer.value = "klima";
        expect(layer.value).toBe("topographie");
        expect(gemeldet).toHaveBeenCalledTimes(2);
        seite.sperreAnsicht(false);
        seite.stelle({ view: "political" });
        expect(seite.ansicht()).toEqual({ view: "political", layer: "topographie" });
        expect(gemeldet).toHaveBeenCalledTimes(2);
        seite.stop();
    });
});

describe("Warten auf die Ruhe der Karte nach dem Umschalten (Thomas 4.2, Stage 2026-10-19)", () => {
    function ersatzKarte() {
        const hoerer = new Set<() => void>();
        return {
            hoerer,
            karte: {
                on: (_art: string, f: () => void) => void hoerer.add(f),
                off: (_art: string, f: () => void) => void hoerer.delete(f),
                triggerRepaint: () => undefined,
            } as never,
        };
    }

    it("🔴 kommt `idle` nie (hängende Kacheln), geht es nach der Frist weiter, und niemand hört mehr zu", async () => {
        const { karte, hoerer } = ersatzKarte();
        const beginn = Date.now();
        await gezeichnet(karte, 30);
        expect(Date.now() - beginn).toBeGreaterThanOrEqual(25);
        expect(hoerer.size).toBe(0);
    });

    it("kommt `idle`, geht es gleich weiter", async () => {
        const { karte, hoerer } = ersatzKarte();
        const warten = gezeichnet(karte, 10_000);
        await vi.waitFor(() => expect(hoerer.size).toBe(1));
        for (const f of [...hoerer]) f();
        await warten;
        expect(hoerer.size).toBe(0);
    });
});
