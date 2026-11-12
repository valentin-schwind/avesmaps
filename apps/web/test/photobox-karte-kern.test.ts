import { describe, expect, it, vi } from "vitest";
import {
    AVENTURIA,
    REISEBILD_RASTER,
    ausschnittGueltig,
    type ReisebildKarte,
    type ReisebilderAntwort,
} from "@avesmaps3d/shared";
import {
    FEHLER_PAUSE_MS,
    VORRAT_ANTEIL,
    VORRAT_MS,
    createReisebilderAbruf,
    erweitereSicht,
} from "../src/photobox/reisebilder-abruf.ts";
import {
    BUENDEL_BEZUGSZOOM,
    BUENDEL_RADIUS,
    buendele,
    fangradius,
    lohntHineinzoomen,
    trenne,
    type BildPunkt,
} from "../src/photobox/reisebilder-buendel.ts";
import {
    OHNE_KI_SCHLUESSEL,
    AUSGEBLENDET_SCHLUESSEL,
    liesOhneKi,
    merkeOhneKi,
    ohneKiZeigbar,
    type OhneKiSpeicher,
} from "../src/photobox/ohne-ki.ts";
import { createReisebilderZustand, ordneWestOst } from "../src/photobox/reisebilder-zustand.ts";
import { createVorschauSpeicher, type VorschauBitmap } from "../src/photobox/reisebilder-vorschau.ts";

/**
 * Abruf, Zustand und Bündeln der Reisebilder im Browser (WI-0272 S4, Aufgabe 25): alles ohne Karte und ohne DOM.
 *
 * Problemfälle: Das Verschieben der Karte fragt den Server bei jedem Schritt, obwohl die Sicht im Vorrat liegt; ein langsamer alter Abruf überschreibt einen neuen; ein Fehler des
 * Servers leert die Karte; zwei gleiche Eingaben bündeln verschieden (die Gruppen springen beim Verschieben); ein Bild an einem Ort liegt auch als freies Symbol auf der Karte;
 * die Leiste ordnet bei jedem Schritt um; ein Bild, dessen Kachel fehlt, bleibt in der Bildansicht stehen.
 * Soll: ein Abruf je Vorrat, der neueste gewinnt, Fehler lassen den Stand stehen, das Bündeln ist reine Funktion der Sicht, gebundene Bilder gehen nur über die Fahne.
 */

const UUID = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function bild(n: number, x = 100, y = 100, extra: Partial<ReisebildKarte> = {}): ReisebildKarte {
    return {
        id: UUID(n),
        lage: { x, y },
        datei: { url: `/media/published/${String(n)}.webp`, breite: 2048, hoehe: 1365 },
        beschreibung: `Bild ${String(n)}`,
        entstehung: "drawing",
        ...extra,
    };
}

const antwort = (bilder: readonly ReisebildKarte[], an = true, gekappt = false): ReisebilderAntwort => ({
    an,
    bilder: [...bilder],
    gekappt,
});

const jsonAntwort = (wert: unknown, status = 200): Response =>
    new Response(JSON.stringify(wert), { status, headers: { "content-type": "application/json" } });

describe("erweitereSicht: ein Viertel Rand, dann auf das Raster", () => {
    it("rundet nach außen auf Vielfache des Rasters und die Sicht liegt im Ergebnis", () => {
        const aus = erweitereSicht({ x0: 500, y0: 500, x1: 600, y1: 560 });
        expect(ausschnittGueltig(aus)).toBe(true);
        // 100 breit, 60 hoch: Rand 25 und 15 -> 475..625 und 485..575 -> Raster 64.
        expect(aus).toEqual({ x0: 448, y0: 448, x1: 640, y1: 576 });
        expect(VORRAT_ANTEIL).toBe(0.25);
        expect(aus.x0 % REISEBILD_RASTER).toBe(0);
    });

    it("klemmt auf die Welt und erträgt vertauschte Ecken", () => {
        const welt = AVENTURIA.coordinateSpace.bounds;
        const aus = erweitereSicht({ x0: welt.maxX + 500, y0: welt.maxY + 500, x1: -500, y1: -500 });
        expect(aus).toEqual({ x0: welt.minX, y0: welt.minY, x1: welt.maxX, y1: welt.maxY });
    });
});

describe("Abruf: Vorrat, Abbruch, Fehler", () => {
    const SICHT = { x0: 500, y0: 500, x1: 600, y1: 560 };

    function aufbau(antworten: (() => Response | Promise<Response>)[] = []) {
        const urls: string[] = [];
        const signale: AbortSignal[] = [];
        const fetcher = vi.fn((eingabe: RequestInfo | URL, init?: RequestInit) => {
            urls.push(String(eingabe));
            if (init?.signal) signale.push(init.signal);
            const naechste = antworten.shift();
            return Promise.resolve(naechste ? naechste() : jsonAntwort(antwort([bild(1)])));
        }) as unknown as typeof fetch;
        let uhr = 1_000_000;
        const abruf = createReisebilderAbruf(fetcher, () => uhr);
        return { abruf, fetcher, urls, signale, uhr: (ms: number) => (uhr += ms) };
    }

    it("fragt den erweiterten Ausschnitt an der Adresse des Lesepfads", async () => {
        const { abruf, urls } = aufbau();
        const got = await abruf.hole(SICHT);
        expect(got?.bilder).toHaveLength(1);
        expect(urls).toEqual(["/api/media/reisebilder?x0=448&y0=448&x1=640&y1=576"]);
    });

    it("🔴 eine Sicht im Vorrat fragt nicht noch einmal; eine Sicht außerhalb fragt", async () => {
        const { abruf, fetcher } = aufbau();
        await abruf.hole(SICHT);
        const klein = await abruf.hole({ x0: 520, y0: 510, x1: 560, y1: 540 });
        expect(klein?.bilder).toHaveLength(1);
        expect(fetcher).toHaveBeenCalledTimes(1);
        await abruf.hole({ x0: 900, y0: 900, x1: 960, y1: 940 });
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("🔴 nach 60 Sekunden fragt es wieder, vorher nicht", async () => {
        const { abruf, fetcher, uhr } = aufbau();
        await abruf.hole(SICHT);
        uhr(VORRAT_MS - 1);
        await abruf.hole(SICHT);
        expect(fetcher).toHaveBeenCalledTimes(1);
        uhr(2);
        await abruf.hole(SICHT);
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("eine Sicht über den Rand der Welt hinaus liegt im Vorrat, wenn die Welt ganz darin liegt", async () => {
        const welt = AVENTURIA.coordinateSpace.bounds;
        const { abruf, fetcher } = aufbau();
        await abruf.hole({ x0: welt.minX - 300, y0: welt.minY - 300, x1: welt.maxX + 300, y1: welt.maxY + 300 });
        await abruf.hole({ x0: welt.minX - 100, y0: welt.minY - 100, x1: welt.maxX + 100, y1: welt.maxY + 100 });
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("🔴 ein neuer Abruf bricht den laufenden ab, und der alte liefert nichts mehr", async () => {
        let loeseAlten: (r: Response) => void = () => undefined;
        const { abruf, signale } = aufbau([
            () =>
                new Promise<Response>((fertig) => {
                    loeseAlten = fertig;
                }),
            () => jsonAntwort(antwort([bild(2)])),
        ]);
        const alt = abruf.hole(SICHT);
        const neu = abruf.hole({ x0: 900, y0: 900, x1: 960, y1: 940 });
        expect(signale[0]?.aborted).toBe(true);
        // Selbst wenn die alte Antwort noch eintrifft, zählt sie nicht.
        loeseAlten(jsonAntwort(antwort([bild(1)])));
        expect(await alt).toBeUndefined();
        expect((await neu)?.bilder.map((b) => b.id)).toEqual([UUID(2)]);
        // Der Vorrat gehört dem neuen Abruf: die Sicht des alten fragt wieder.
    });

    it("🔴 429, 5xx und ein Netzfehler lassen den letzten Stand stehen, ohne Wurf", async () => {
        const { abruf, uhr } = aufbau([
            () => jsonAntwort(antwort([bild(1)])),
            () => jsonAntwort({ error: { code: "reisebilder_rate" } }, 429),
            () => jsonAntwort({ error: { code: "x" } }, 503),
            () => Promise.reject(new TypeError("Failed to fetch")),
        ]);
        const erst = await abruf.hole(SICHT);
        expect(erst?.bilder).toHaveLength(1);
        for (let i = 0; i < 3; i += 1) {
            uhr(VORRAT_MS + FEHLER_PAUSE_MS + 1);
            await expect(abruf.hole(SICHT)).resolves.toBeUndefined();
        }
    });

    it("nach einem Fehler wartet es eine Pause ab, statt bei jedem Schritt der Karte zu fragen", async () => {
        const { abruf, fetcher, uhr } = aufbau([() => jsonAntwort({}, 429)]);
        await abruf.hole(SICHT);
        uhr(FEHLER_PAUSE_MS - 1);
        await abruf.hole(SICHT);
        expect(fetcher).toHaveBeenCalledTimes(1);
        uhr(2);
        await abruf.hole(SICHT);
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("🔴 `an: false` leert die Bilder, auch wenn der Server welche mitschickt", async () => {
        const { abruf } = aufbau([() => jsonAntwort(antwort([bild(1)], false))]);
        expect(await abruf.hole(SICHT)).toEqual({ an: false, bilder: [], gekappt: false });
    });

    it("🔴 ein Bild mit halbem Ort (ohne Lage) fällt leise heraus, statt die Karte beim Bündeln zu werfen", async () => {
        const kaputt = bild(2, 100, 100, { ort: { id: UUID(9), name: "Gareth", subtype: "metropole" } as never });
        const ganz = bild(3, 100, 100, {
            ort: { id: UUID(9), name: "Gareth", subtype: "metropole", lage: { x: 100, y: 100 } },
        });
        const { abruf } = aufbau([() => jsonAntwort(antwort([bild(1), kaputt, ganz]))]);
        const hole = await abruf.hole(SICHT);
        expect(hole?.bilder.map((b) => b.id)).toEqual([UUID(1), UUID(3)]);
    });

    it("eine Antwort, die kein Reisebild-Vertrag ist, bleibt ohne Wirkung", async () => {
        const { abruf } = aufbau([() => jsonAntwort({ irgendwas: 1 }), () => jsonAntwort("text")]);
        expect(await abruf.hole(SICHT)).toBeUndefined();
    });

    it("`vergiss` leert den Vorrat: die nächste Sicht fragt", async () => {
        const { abruf, fetcher } = aufbau();
        await abruf.hole(SICHT);
        abruf.vergiss();
        await abruf.hole(SICHT);
        expect(fetcher).toHaveBeenCalledTimes(2);
    });
});

describe("Bündeln", () => {
    const punkt = (n: number, x: number, y: number, extra: Partial<BildPunkt> = {}): BildPunkt => ({
        id: UUID(n),
        x,
        y,
        lng: x / 10,
        lat: y / 10,
        ...extra,
    });

    it("🔴 enge Punkte fallen zusammen, weite nicht", () => {
        const gruppen = buendele([punkt(1, 100, 100), punkt(2, 130, 100), punkt(3, 400, 400)], 50);
        expect(gruppen.map((g) => g.ids)).toEqual([[UUID(1), UUID(2)], [UUID(3)]]);
        const zwei = gruppen[0];
        expect(zwei).toMatchObject({ schluessel: UUID(1), x: 115, y: 100 });
        expect(zwei?.lng).toBeCloseTo(11.5);
        // Genau auf dem Radius gilt als weit (wie die Probierseite: kleiner als).
        expect(buendele([punkt(1, 0, 0), punkt(2, 50, 0)], 50)).toHaveLength(2);
    });

    it("der Fangradius wächst unter dem Bezugszoom und bleibt darüber gleich", () => {
        expect(BUENDEL_BEZUGSZOOM).toBe(5);
        expect(fangradius(5, "zeichen")).toBe(50);
        expect(fangradius(7, "zeichen")).toBe(50);
        expect(fangradius(8.5, "vorschau")).toBe(60);
        expect(fangradius(3, "zeichen")).toBeCloseTo(100);
        expect(fangradius(1, "vorschau")).toBeCloseTo(240);
        expect(fangradius(3, "vorschau")).toBeGreaterThan(fangradius(4, "vorschau"));
        expect(BUENDEL_RADIUS).toEqual({ zeichen: 50, vorschau: 60 });
    });

    it("🔴 dieselbe Eingabe in anderer Reihenfolge gibt dieselben Gruppen", () => {
        const eingabe = [
            punkt(5, 10, 10),
            punkt(2, 20, 12),
            punkt(9, 300, 300),
            punkt(4, 28, 8),
            punkt(7, 305, 310),
            punkt(1, 700, 20),
        ];
        const vorwaerts = buendele(eingabe, 50);
        const rueckwaerts = buendele([...eingabe].reverse(), 50);
        const gemischt = buendele([eingabe[3]!, eingabe[0]!, eingabe[5]!, eingabe[1]!, eingabe[4]!, eingabe[2]!], 50);
        expect(rueckwaerts).toEqual(vorwaerts);
        expect(gemischt).toEqual(vorwaerts);
    });

    it("🔴 der Schlüssel bleibt, wenn ein weiteres Bild dazukommt", () => {
        const vorher = buendele([punkt(1, 100, 100), punkt(2, 120, 110)], 50);
        const nachher = buendele([punkt(1, 100, 100), punkt(2, 120, 110), punkt(3, 140, 100)], 50);
        expect(vorher.map((g) => g.schluessel)).toEqual([UUID(1)]);
        expect(nachher.map((g) => g.schluessel)).toEqual([UUID(1)]);
        expect(nachher[0]?.ids).toEqual([UUID(1), UUID(2), UUID(3)]);
    });

    it("🔴 `trenne`: ein gebundenes Bild liegt nie in `frei`", () => {
        const punkte = [
            punkt(1, 10, 10),
            punkt(2, 20, 20, { ortId: "o-gareth" }),
            punkt(3, 30, 30, { ortId: "o-gareth" }),
            punkt(4, 40, 40, { ortId: "o-rommilys" }),
        ];
        const { frei, gebunden } = trenne(punkte);
        expect(frei.map((p) => p.id)).toEqual([UUID(1)]);
        expect(frei.some((p) => p.ortId !== undefined)).toBe(false);
        expect([...gebunden.keys()].sort()).toEqual(["o-gareth", "o-rommilys"]);
        expect(gebunden.get("o-gareth")?.map((p) => p.id)).toEqual([UUID(2), UUID(3)]);
    });

    it("`lohntHineinzoomen`: nein bei gleicher Stelle und am höchsten Zoom, ja bei weit auseinander", () => {
        const nah = [punkt(1, 100, 100), punkt(2, 100, 100)];
        const [gleich] = buendele(nah, 50);
        expect(lohntHineinzoomen(gleich!, nah, 4, 8)).toBe(false);

        const weit = [punkt(1, 100, 100), punkt(2, 140, 100)];
        const [gruppe] = buendele(weit, 50);
        // Größter Abstand zur Mitte 20, mal 4 sind 80 > 58.
        expect(lohntHineinzoomen(gruppe!, weit, 4, 8)).toBe(true);
        expect(lohntHineinzoomen(gruppe!, weit, 7.96, 8)).toBe(false);
        expect(lohntHineinzoomen(gruppe!, weit, 8, 8)).toBe(false);

        // 14 px Abstand zur Mitte: mal 4 sind 56, das reicht nicht.
        const eng = [punkt(1, 100, 100), punkt(2, 128, 100)];
        const [kaum] = buendele(eng, 50);
        expect(lohntHineinzoomen(kaum!, eng, 4, 8)).toBe(false);
    });
});

describe("Zustand", () => {
    it("🔴 die Bilder im Bild stehen von West nach Ost, bei gleichem x von Nord nach Süd", () => {
        const geordnet = ordneWestOst([bild(1, 300, 10), bild(2, 100, 50), bild(3, 100, 90), bild(4, 200, 0)]);
        expect(geordnet.map((b) => b.id)).toEqual([UUID(3), UUID(2), UUID(4), UUID(1)]);
        const z = createReisebilderZustand();
        z.setzeImBild([bild(1, 300, 10), bild(2, 100, 50), bild(3, 100, 90)]);
        expect(z.imBild.value.map((b) => b.id)).toEqual([UUID(3), UUID(2), UUID(1)]);
    });

    it("`setzeAntwort` übernimmt die Antwort; `an: false` leert die Bilder", () => {
        const z = createReisebilderZustand();
        z.setzeAntwort(antwort([bild(1), bild(2)], true, true));
        expect(z.an.value).toBe(true);
        expect(z.bilder.value).toHaveLength(2);
        expect(z.gekappt.value).toBe(true);
        z.setzeAntwort(antwort([bild(1)], false));
        expect(z.an.value).toBe(false);
        expect(z.bilder.value).toEqual([]);
        expect(z.imBild.value).toEqual([]);
    });

    it("🔴 Schließen der Leiste leert die Markierung und das Hervorheben", () => {
        const z = createReisebilderZustand();
        z.setzeLeiste(true);
        z.markiere([UUID(1), UUID(2)]);
        z.setzeHervor(UUID(2));
        expect(z.markiert.value.has(UUID(1))).toBe(true);
        expect(z.hervor.value).toBe(UUID(2));
        z.setzeLeiste(false);
        expect(z.leisteOffen.value).toBe(false);
        expect(z.markiert.value.size).toBe(0);
        expect(z.hervor.value).toBeUndefined();
    });

    it("die Bildansicht blättert in der Liste der Leiste; eine fremde Kennung öffnet nur sie selbst", () => {
        const z = createReisebilderZustand();
        z.setzeImBild([bild(1, 10), bild(2, 20), bild(3, 30)]);
        z.oeffneAnsicht(UUID(2));
        expect(z.ansicht.value).toEqual({ liste: [UUID(1), UUID(2), UUID(3)], stelle: 1 });
        z.oeffneAnsicht(UUID(9));
        expect(z.ansicht.value).toEqual({ liste: [UUID(9)], stelle: 0 });
        z.oeffneAnsicht(UUID(3), [UUID(3), UUID(1)]);
        expect(z.ansicht.value).toEqual({ liste: [UUID(3), UUID(1)], stelle: 0 });
        z.schliesseAnsicht();
        expect(z.ansicht.value).toBeUndefined();
    });

    it("🔴 `vergissBild` entfernt aus allen Listen, auch aus der offenen Bildansicht, und schließt sie, wenn nichts bleibt", () => {
        const z = createReisebilderZustand();
        const neuLaden = vi.fn();
        z.verbindeKarte({ schirmVon: () => undefined, zeige: () => undefined, neuLaden });
        z.setzeAntwort(antwort([bild(1, 10), bild(2, 20), bild(3, 30)]));
        z.setzeImBild(z.bilder.value);
        z.setzeLeiste(true);
        z.markiere([UUID(1), UUID(2)]);
        z.setzeHervor(UUID(2));
        z.oeffneAnsicht(UUID(2));
        z.vergissBild(UUID(2));
        expect(z.bilder.value.map((b) => b.id)).toEqual([UUID(1), UUID(3)]);
        expect(z.imBild.value.map((b) => b.id)).toEqual([UUID(1), UUID(3)]);
        expect([...z.markiert.value]).toEqual([UUID(1)]);
        expect(z.hervor.value).toBeUndefined();
        // Das Bild der Ansicht ist weg: Es steht jetzt das, was an seine Stelle rückt.
        expect(z.ansicht.value).toEqual({ liste: [UUID(1), UUID(3)], stelle: 1 });
        // Der Abruf wird neu angestoßen (Vorrat leeren, neu fragen).
        expect(neuLaden).toHaveBeenCalledTimes(1);

        z.vergissBild(UUID(3));
        z.vergissBild(UUID(1));
        expect(z.ansicht.value).toBeUndefined();
    });

    it("`vergissBild` eines Bildes davor rückt die Stelle der Ansicht nach", () => {
        const z = createReisebilderZustand();
        z.setzeImBild([bild(1, 10), bild(2, 20), bild(3, 30)]);
        z.oeffneAnsicht(UUID(3));
        z.vergissBild(UUID(1));
        expect(z.ansicht.value).toEqual({ liste: [UUID(2), UUID(3)], stelle: 1 });
    });

    it("`verbindeKarte`: schirmVon und zeige gehen an die Karte; das Abmelden löst sie", () => {
        const z = createReisebilderZustand();
        expect(z.schirmVon(UUID(1))).toBeUndefined();
        const zeige = vi.fn();
        const ab = z.verbindeKarte({ schirmVon: (id) => ({ x: 5, y: id === UUID(1) ? 7 : 0 }), zeige });
        expect(z.schirmVon(UUID(1))).toEqual({ x: 5, y: 7 });
        z.zeige(UUID(1));
        expect(zeige).toHaveBeenCalledWith(UUID(1));
        ab();
        expect(z.schirmVon(UUID(1))).toBeUndefined();
        z.zeige(UUID(1));
        expect(zeige).toHaveBeenCalledTimes(1);
    });

    it("`leere` nimmt alles zurück (die Ansicht verlässt die Standardkarte)", () => {
        const z = createReisebilderZustand();
        z.setzeAntwort(antwort([bild(1)]));
        z.setzeImBild(z.bilder.value);
        z.setzeLeiste(true);
        z.oeffneAnsicht(UUID(1));
        z.leere();
        expect(z.bilder.value).toEqual([]);
        expect(z.imBild.value).toEqual([]);
        expect(z.leisteOffen.value).toBe(false);
        expect(z.ansicht.value).toBeUndefined();
    });
});

describe("Vorschau-Speicher: nachladen, begrenzen, schweigen (Aufgabe 29)", () => {
    const kachel = (): VorschauBitmap => ({ width: 120, height: 80, close: vi.fn() }) as unknown as VorschauBitmap;

    /** Eine Karte aus Mengen und ein Lader, der erst auf `loese` antwortet. */
    function aufbau(optionen: { grenze?: number; gleichzeitig?: number } = {}) {
        const bilder = new Set<string>();
        const karte = {
            hasImage: (id: string) => bilder.has(id),
            addImage: (id: string) => void bilder.add(id),
            removeImage: (id: string) => void bilder.delete(id),
        };
        const offen = new Map<string, { gut: () => void; schlecht: () => void }>();
        let laufend = 0;
        let hoechstens = 0;
        const geladen: string[] = [];
        const laden = vi.fn(
            (url: string) =>
                new Promise<VorschauBitmap>((gut, schlecht) => {
                    geladen.push(url);
                    laufend += 1;
                    hoechstens = Math.max(hoechstens, laufend);
                    offen.set(url, {
                        gut: () => {
                            laufend -= 1;
                            gut(kachel());
                        },
                        schlecht: () => {
                            laufend -= 1;
                            schlecht(new Error("404"));
                        },
                    });
                }),
        );
        const fertig = vi.fn();
        const speicher = createVorschauSpeicher(karte as never, {
            laden,
            zeichne: () => ({}) as ImageData,
            onFertig: fertig,
            ...optionen,
        });
        const loese = async (n: number, wie: "gut" | "schlecht" = "gut"): Promise<void> => {
            offen.get(`/media/published/${String(n)}.webp`)?.[wie]();
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        };
        return { speicher, bilder, laden, fertig, loese, hoechstens: () => hoechstens, geladen };
    }

    it("liefert erst `undefined` und beginnt zu laden; nach dem Laden die Kennung, und `onFertig` kommt", async () => {
        const { speicher, bilder, fertig, loese } = aufbau();
        expect(speicher.vorschauId(bild(1), 40, 1, false)).toBeUndefined();
        await loese(1);
        expect(fertig).toHaveBeenCalledTimes(1);
        const id = speicher.vorschauId(bild(1), 40, 1, false);
        expect(id).toBeDefined();
        expect(bilder.has(id!)).toBe(true);
    });

    it("🔴 höchstens vier Ladevorgänge zugleich; ein zweiter Wunsch lädt nicht doppelt", async () => {
        const { speicher, laden, hoechstens, loese } = aufbau();
        for (let n = 1; n <= 7; n += 1) speicher.vorschauId(bild(n), 40, 1, false);
        for (let n = 1; n <= 7; n += 1) speicher.vorschauId(bild(n), 40, 1, false);
        expect(laden).toHaveBeenCalledTimes(4);
        expect(hoechstens()).toBe(4);
        await loese(1);
        expect(laden).toHaveBeenCalledTimes(5);
        expect(hoechstens()).toBe(4);
    });

    it("🔴 ein Fehler bleibt still beim Zeichen und fragt nicht in jeder Runde neu", async () => {
        const { speicher, laden, loese } = aufbau();
        expect(speicher.vorschauId(bild(1), 40, 1, false)).toBeUndefined();
        await loese(1, "schlecht");
        expect(speicher.vorschauId(bild(1), 40, 1, false)).toBeUndefined();
        expect(speicher.vorschauId(bild(1), 40, 1, false)).toBeUndefined();
        expect(laden).toHaveBeenCalledTimes(1);
    });

    it("🔴 die Grenze wirft Alte hinaus, nie ein Bild der laufenden Runde", async () => {
        const { speicher, bilder, loese } = aufbau({ grenze: 2 });
        for (let n = 1; n <= 4; n += 1) speicher.vorschauId(bild(n), 40, 1, false);
        for (let n = 1; n <= 4; n += 1) await loese(n);
        speicher.rundeEnde();
        // Neue Runde: nur 3 und 4 sind gebraucht; 1 und 2 sind über der Grenze und fallen, 3 und 4 bleiben.
        const ids = [3, 4].map((n) => speicher.vorschauId(bild(n), 40, 1, false)!);
        for (const n of [1, 2]) speicher.vorschauId(bild(n), 40, 1, false);
        speicher.rundeEnde();
        expect(bilder.size).toBeLessThanOrEqual(2 + 2);
        for (const id of ids) expect(bilder.has(id)).toBe(true);
        // Ein Bild der Runde bleibt auch über der Grenze stehen.
        const alle = [1, 2, 3, 4].map((n) => speicher.vorschauId(bild(n), 40, 1, false)!);
        speicher.rundeEnde();
        for (const id of alle) expect(bilder.has(id)).toBe(true);
    });

    it("`nachmelden` zeichnet einen Abzug neu, den die Karte vermisst; fremde Kennungen nicht", async () => {
        const { speicher, bilder, loese } = aufbau();
        speicher.vorschauId(bild(1), 40, 2, true);
        await loese(1);
        const id = speicher.vorschauId(bild(1), 40, 2, true)!;
        bilder.delete(id);
        expect(speicher.nachmelden(id)).toBe(true);
        expect(bilder.has(id)).toBe(true);
        expect(speicher.nachmelden("photobox-zeichen-2")).toBe(false);
    });
});

describe("Die Filter der Leiste (Vali 2026-11-03, Probierseite Fassung 2)", () => {
    const KI = { entstehung: "ai_generated" } as const;
    const ids = (liste: readonly ReisebildKarte[]): string[] => liste.map((b) => b.id);
    const tafel = (
        start: Record<string, string> = {},
    ): OhneKiSpeicher & { werte: Map<string, string>; schreibt: number } => {
        const werte = new Map(Object.entries(start));
        const ablage = {
            werte,
            schreibt: 0,
            getItem: (schluessel: string) => werte.get(schluessel) ?? null,
            setItem(schluessel: string, wert: string) {
                ablage.schreibt += 1;
                werte.set(schluessel, wert);
            },
            removeItem(schluessel: string) {
                ablage.schreibt += 1;
                werte.delete(schluessel);
            },
        };
        return ablage;
    };
    /** Ein Zustand, dessen Karte wie die echte auf einen Filter antwortet. */
    const mitKarte = (speicher = tafel()) => {
        const z = createReisebilderZustand(speicher);
        const gemeldet = vi.fn(() => z.setzeImBild(z.bilder.value));
        z.verbindeKarte({ schirmVon: () => undefined, zeige: () => undefined, filterGeaendert: gemeldet });
        return { z, gemeldet, speicher };
    };

    it("🔴 „Ohne KI“ lässt nur bekannte Angaben ohne KI durch: KI-Bilder und Unbekanntes fallen heraus", () => {
        expect(["drawing", "photo", "avesmaps_capture"].every(ohneKiZeigbar)).toBe(true);
        expect(["ai_generated", "unknown", "", "scan"].some(ohneKiZeigbar)).toBe(false);
        expect(ohneKiZeigbar(undefined)).toBe(false);
    });

    it("🔴 „Ohne KI“ nimmt die Bilder aus Karte und Leiste; Ausschalten bringt sie ohne neue Anfrage zurück", () => {
        const { z, gemeldet } = mitKarte();
        z.setzeAntwort(antwort([bild(1), bild(2, 100, 100, KI), bild(3, 100, 100, { entstehung: "photo" })]));
        z.setzeImBild(z.bilder.value);
        z.setzeOhneKi(true);
        expect(ids(z.bilder.value)).toEqual([UUID(1), UUID(3)]);
        expect(ids(z.imBild.value)).toEqual([UUID(1), UUID(3)]);
        expect(gemeldet).toHaveBeenCalledTimes(1);
        z.setzeOhneKi(false);
        expect(ids(z.bilder.value)).toEqual([UUID(1), UUID(2), UUID(3)]);
        expect(ids(z.imBild.value)).toEqual([UUID(1), UUID(2), UUID(3)]);
    });

    it("die nächste Antwort des Abrufs kommt gefiltert an (Ortswechsel), „an: false“ zeigt nichts", () => {
        const { z } = mitKarte();
        z.setzeOhneKi(true);
        z.setzeAntwort(antwort([bild(5, 100, 100, KI), bild(6)]));
        expect(ids(z.bilder.value)).toEqual([UUID(6)]);
        z.setzeAntwort(antwort([], false));
        expect(z.bilder.value).toEqual([]);
    });

    it("was der Filter nimmt, verliert Markierung und Hervorhebung", () => {
        const { z } = mitKarte();
        z.setzeAntwort(antwort([bild(1), bild(2, 100, 100, KI)]));
        z.markiere([UUID(1), UUID(2)]);
        z.setzeHervor(UUID(2), "kachel");
        z.setzeOhneKi(true);
        expect([...z.markiert.value]).toEqual([UUID(1)]);
        expect(z.hervor.value).toBeUndefined();
    });

    it("🔴 gemerkt wird erst beim Einschalten, das Ausschalten lässt nichts liegen; Neuladen und `leere` behalten den Filter", () => {
        const speicher = tafel();
        const erst = createReisebilderZustand(speicher);
        expect(erst.ohneKi.value).toBe(false);
        expect(speicher.schreibt).toBe(0);
        erst.setzeOhneKi(true);
        expect(speicher.werte.get(OHNE_KI_SCHLUESSEL)).toBe("an");
        erst.leere();
        expect(erst.ohneKi.value).toBe(true);

        const neu = createReisebilderZustand(speicher);
        expect(neu.ohneKi.value).toBe(true);
        neu.setzeOhneKi(false);
        expect(speicher.werte.size).toBe(0);
    });

    it("🔴 „Reisebilder ausblenden“ meldet sich bei der Karte, lässt Bilder und Kacheln stehen und bleibt gemerkt, auch über `leere`", () => {
        const speicher = tafel();
        const z = createReisebilderZustand(speicher);
        z.setzeAntwort(antwort([bild(1)]));
        z.setzeImBild(z.bilder.value);
        let meldungen = 0;
        z.verbindeKarte({
            schirmVon: () => undefined,
            zeige: () => undefined,
            filterGeaendert: () => {
                meldungen += 1;
            },
        });
        expect(z.ausgeblendet.value).toBe(false);
        expect(speicher.schreibt).toBe(0);

        z.setzeAusgeblendet(true);
        expect(meldungen).toBe(1);
        expect(z.bilder.value).toHaveLength(1);
        expect(z.imBild.value).toHaveLength(1);
        expect(speicher.werte.get(AUSGEBLENDET_SCHLUESSEL)).toBe("an");
        z.leere();
        expect(z.ausgeblendet.value).toBe(true);

        const neu = createReisebilderZustand(speicher);
        expect(neu.ausgeblendet.value).toBe(true);
        neu.setzeAusgeblendet(false);
        expect(speicher.werte.size).toBe(0);
    });

    it("ein gesperrter Speicher wirft nie: Der Filter gilt bis zum Neuladen", () => {
        const gesperrt: OhneKiSpeicher = {
            getItem() {
                throw new Error("gesperrt");
            },
            setItem() {
                throw new Error("gesperrt");
            },
            removeItem() {
                throw new Error("gesperrt");
            },
        };
        expect(liesOhneKi(gesperrt)).toBe(false);
        expect(() => merkeOhneKi(true, gesperrt)).not.toThrow();
        const z = createReisebilderZustand(gesperrt);
        z.setzeOhneKi(true);
        expect(z.ohneKi.value).toBe(true);
    });

    it("🔴 „Meine“ zeigt alle eigenen, wo auch immer sie liegen; die Antwort des Abrufs läuft nebenher, Ausschalten holt sie zurück", () => {
        const { z } = mitKarte();
        z.setzeAntwort(antwort([bild(1), bild(2)], true, true));
        z.setzeImBild(z.bilder.value);
        z.setzeMeine(true);
        expect(z.bilder.value).toEqual([]);
        z.setzeMeineKarten([bild(8, 900), bild(9, 10)]);
        expect(ids(z.imBild.value)).toEqual([UUID(9), UUID(8)]);
        expect(z.gekappt.value).toBe(false);
        z.setzeAntwort(antwort([bild(3)]));
        expect(ids(z.bilder.value)).toEqual([UUID(8), UUID(9)]);
        z.setzeMeine(false);
        expect(ids(z.bilder.value)).toEqual([UUID(3)]);
    });

    it("„Meine“ und „Ohne KI“ gelten zusammen; `leere` schaltet nur „Meine“ aus", () => {
        const { z } = mitKarte();
        z.setzeAntwort(antwort([bild(1)]));
        z.setzeOhneKi(true);
        z.setzeMeine(true);
        z.setzeMeineKarten([bild(8), bild(9, 100, 100, KI)]);
        expect(ids(z.imBild.value)).toEqual([UUID(8)]);
        z.leere();
        expect(z.nurMeine.value).toBe(false);
        expect(z.ohneKi.value).toBe(true);
    });
});
