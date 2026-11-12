import { shallowRef, watch, type ShallowRef } from "vue";
import type { EditorPowerlineDetail, EditorPowerlineTargets } from "@avesmaps3d/shared";
import type { Bearbeitung, FormTeil } from "../fenster/bearbeitung";
import type { Entwurf } from "../fenster/entwurf-kern";
import type { Punkt, Ziel } from "../map/geometrie/geometrie";
import type { Umriss } from "../map/geometrie/kamera";
import { KRAFTLINIE, kraftlinienScheitel } from "../map/geometrie/kraftlinie";
import type { GeometrieEingabe, GeometrieModus } from "../map/geometrie/modus";
import {
    formAus,
    formNach,
    mitAbschnitt,
    ohneKnoten,
    zieleAus,
    type KraftlinieFelder,
    type KraftlinieForm,
    type NeuerKnoten,
} from "./kraftlinie-art";

/**
 * „Kurve bearbeiten“ (WI-0205 K8 auf O3; EDIT-0003 T44, T27 (4), (7)): die Form der Kraftlinie als Anschluss an die Bearbeitung ihres
 * Fensters (`bearbeitung.formEntwurf(teil)`). Diese Datei ist der Besitzer der Form: Sie schaltet das Geometrie-Modul mit der Art
 * `KRAFTLINIE` ein (je Abschnitt der Scheitel des Bogens und die beiden Enden) und zeichnet die Karte neu; Schritte, Frage, Sperre,
 * „Fertig“ und Konflikt gehören der Bearbeitung.
 *
 * - **Start:** erst die Ziele (die Nodices zum Einrasten), dann hängt die Form an (`beginne`, die Sperre wird `form`). Hält ein anderer
 *   die Linie, endet die Bearbeitung, und die Griffe gehen aus (`beende`). Mitten im Felder-Entwurf bleiben dessen Schritte stehen.
 * - **Handbewegung:** Ein Zug am Scheitel oder ein umgehängtes Ende ist ein Schritt (`formNach`); ein Ende ins Leere setzt nichts
 *   (R4), ein Hinweis sagt es. Während geschrieben wird, sind die Griffe gesperrt.
 * - **Ende:** „Fertig“, Esc und das Ende der Bearbeitung schalten die Griffe aus. `haengeAb` hängt nur die Form ab und lässt den
 *   Entwurf stehen (das Fenster wird abgelegt oder geschlossen, eine andere Kurve beginnt).
 * - **Nodix herausnehmen und anfügen** (T28 (5), R5; `nimmHeraus`, `fuegeAn`): je ein Schritt im selben Entwurf, „Fertig“ schreibt sie
 *   mit Kurve und Feldern als EINE Operation. Läuft die Kurve noch nicht, hängt sie erst an, damit man sieht, was sich ändert.
 */

export type KraftlinieBearbeitung = Bearbeitung<EditorPowerlineDetail, KraftlinieFelder, KraftlinieForm>;

export interface KurveKarte {
    /** Schaltet das Geometrie-Modul für die Linie ein; ohne Karte `undefined`. */
    ein(eingabe: GeometrieEingabe): GeometrieModus | undefined;
    /** Die Linie in die freie Fläche holen, wenn nichts von ihr frei zu sehen ist (`map/geometrie/kamera.ts`). */
    zeige(teile: readonly Umriss[]): void;
}

export interface KurveOptionen {
    ziele(anker: string, signal: AbortSignal): Promise<EditorPowerlineTargets | null>;
    readonly karte: KurveKarte;
    fangradius(): number;
    /** Ein Hinweis: ein Ende ins Leere (R4), oder Linie und Ziele ließen sich nicht laden. */
    melde(art: "kein-ziel" | "ladefehler"): void;
}

/** Was ein Schritt an der Form ergab: getan, oder warum nicht (`fremd`: gehört nicht zur Linie, `letzter`: der letzte Abschnitt). */
export type FormSchritt = "ok" | "fremd" | "letzter" | "nicht";

export interface KraftlinieKurve {
    /** Die Bearbeitung, deren Kurve gerade auf der Karte liegt. */
    readonly laufend: Readonly<ShallowRef<KraftlinieBearbeitung | undefined>>;
    /** Die Nodices, an denen ein Ende einrasten oder angefügt werden kann, solange die Kurve läuft. */
    readonly ziele: Readonly<ShallowRef<readonly Ziel[]>>;
    starte(bearbeitung: KraftlinieBearbeitung): Promise<void>;
    /** Einen Nodix aus der Linie nehmen (R5). */
    nimmHeraus(bearbeitung: KraftlinieBearbeitung, knoten: string): Promise<FormSchritt>;
    /** Von einem Knoten der Linie zu einem Nodix einen Abschnitt anfügen. */
    fuegeAn(bearbeitung: KraftlinieBearbeitung, von: string, nach: string): Promise<FormSchritt>;
    /** Die Form abhängen, der Entwurf bleibt stehen. */
    haengeAb(): void;
    destroy(): void;
}

/** Wartet, bis die Bearbeitung ihren Stand gelesen hat (oder nicht); `abbrechen` gibt das Warten auf. */
function bisGelesen(bearbeitung: KraftlinieBearbeitung): { fertig: Promise<void>; abbrechen: () => void } {
    if (bearbeitung.zustand.value.art !== "laedt") return { fertig: Promise.resolve(), abbrechen: () => undefined };
    let stop = (): void => undefined;
    const fertig = new Promise<void>((weiter) => {
        stop = watch(
            () => bearbeitung.zustand.value.art,
            (art) => {
                if (art === "laedt") return;
                stop();
                weiter();
            },
        );
    });
    return { fertig, abbrechen: () => stop() };
}

export function createKraftlinieKurve(optionen: KurveOptionen): KraftlinieKurve {
    const laufend = shallowRef<KraftlinieBearbeitung | undefined>(undefined);
    let modus: GeometrieModus | undefined;
    let sicht: Entwurf<KraftlinieForm> | undefined;
    let ziele: Ziel[] = [];
    const zieleRef = shallowRef<readonly Ziel[]>([]);
    let lesen: AbortController | undefined;
    let warten: (() => void) | undefined;
    let stopSperre: (() => void) | undefined;
    /** Zählt die Läufe: Eine späte Antwort gehört nicht mehr zum nächsten. */
    let lauf = 0;

    function raeumeAuf(): void {
        lauf += 1;
        lesen?.abort();
        lesen = undefined;
        warten?.();
        warten = undefined;
        stopSperre?.();
        stopSperre = undefined;
        modus?.aus();
        modus = undefined;
        sicht = undefined;
        ziele = [];
        zieleRef.value = [];
        laufend.value = undefined;
    }

    function haengeAb(): void {
        const war = sicht;
        raeumeAuf();
        war?.leere();
    }

    const teil: FormTeil = {
        zurueck() {
            sicht?.zurueck();
            modus?.aktualisiere();
        },
        wieder() {
            sicht?.wieder();
            modus?.aktualisiere();
        },
        verwerfen() {
            sicht?.verwerfen();
            modus?.aktualisiere();
        },
        abbrechen() {
            if (modus?.abbrechen() === true) return true;
            // Esc ohne laufenden Zug: die Frage der Bearbeitung; „ende“ beendet sie und ruft `beende`.
            const wie = sicht?.esc();
            if (wie !== undefined && wie !== "ende") modus?.aktualisiere();
            return true;
        },
        beende: raeumeAuf,
    };

    async function starte(bearbeitung: KraftlinieBearbeitung): Promise<void> {
        if (laufend.value === bearbeitung) return;
        haengeAb();
        const meiner = lauf;
        const gelesen = bisGelesen(bearbeitung);
        warten = gelesen.abbrechen;
        await gelesen.fertig;
        if (meiner !== lauf) return;
        warten = undefined;
        const linie = bearbeitung.detail.value;
        if (linie === undefined) {
            optionen.melde("ladefehler");
            return;
        }
        const steuer = new AbortController();
        lesen = steuer;
        let gefunden: EditorPowerlineTargets | null;
        try {
            gefunden = await optionen.ziele(linie.id, steuer.signal);
        } catch {
            gefunden = null;
        }
        if (meiner !== lauf) return;
        lesen = undefined;
        if (gefunden === null) {
            optionen.melde("ladefehler");
            return;
        }
        ziele = zieleAus(gefunden);
        zieleRef.value = ziele;
        const eigene = bearbeitung.formEntwurf(teil);
        sicht = eigene;
        modus = optionen.karte.ein({
            art: KRAFTLINIE,
            teile: () => eigene.jetzt()?.teile ?? [],
            nachbarn: () => [],
            ziele: () => ziele,
            orte: () => [],
            fangradius: optionen.fangradius,
            handbewegung(aenderung) {
                const jetzt = eigene.jetzt();
                if (jetzt === undefined || bearbeitung.zustand.value.art === "speichert") return;
                const neu = formNach(jetzt, aenderung);
                if (neu === undefined) {
                    // Ein Ende ins Leere setzt nichts (R4): zurück an seinen Nodix.
                    modus?.aktualisiere();
                    optionen.melde("kein-ziel");
                    return;
                }
                eigene.schritt(neu);
                modus?.aktualisiere();
            },
        });
        if (modus === undefined) {
            sicht = undefined;
            return;
        }
        laufend.value = bearbeitung;
        // Die Form hängt an und nimmt die Sperre; hält ein anderer die Linie, endet die Bearbeitung und ruft `beende`.
        eigene.beginne(formAus(linie));
        if (meiner !== lauf) return;
        modus.aktualisiere();
        stopSperre = watch(
            () => bearbeitung.zustand.value.art,
            (art) => modus?.sperre(art === "speichert"),
            { immediate: true },
        );
        // Der Scheitel eines Bogens ist ein Griff wie die Enden: Auch er soll in der freien Karte stehen, nicht unter dem Fenster. Jeder
        // Abschnitt ein eigener Linienzug über den Scheitel, damit kein Sprung zwischen zwei Abschnitten als „zu sehen“ zählt.
        optionen.karte.zeige(
            (eigene.jetzt()?.teile ?? []).map((t) => {
                const [a, b] = t.punkte;
                return {
                    art: t.art,
                    punkte: a !== undefined && b !== undefined ? [a, kraftlinienScheitel(a, b, t.wert), b] : t.punkte,
                };
            }),
        );
    }

    /** Ein Schritt an der Form; läuft die Kurve dieser Bearbeitung nicht, hängt sie erst an. */
    async function schritt(
        bearbeitung: KraftlinieBearbeitung,
        neu: (form: KraftlinieForm, linie: EditorPowerlineDetail) => KraftlinieForm | Exclude<FormSchritt, "ok">,
    ): Promise<FormSchritt> {
        if (laufend.value !== bearbeitung) await starte(bearbeitung);
        const eigene = sicht;
        const linie = bearbeitung.detail.value;
        const jetzt = eigene?.jetzt();
        if (laufend.value !== bearbeitung || eigene === undefined || linie === undefined || jetzt === undefined)
            return "nicht";
        if (bearbeitung.zustand.value.art === "speichert") return "nicht";
        const ergebnis = neu(jetzt, linie);
        if (typeof ergebnis === "string") return ergebnis;
        eigene.schritt(ergebnis);
        modus?.aktualisiere();
        return "ok";
    }

    /** Wo ein Knoten der Linie liegt: aus dem Entwurf (auch ein angefügter), sonst aus dem gelesenen Stand. */
    function lageVon(form: KraftlinieForm, linie: EditorPowerlineDetail, knoten: string): Punkt | undefined {
        for (const t of form.teile) {
            const e = form.enden[t.objekt];
            if (e?.from === knoten) return t.punkte[0];
            if (e?.to === knoten) return t.punkte[1];
        }
        const k = linie.nodes.find((n) => n.id === knoten);
        return k?.x !== undefined && k.y !== undefined ? { x: k.x, y: k.y } : undefined;
    }

    const ART: Record<Ziel["art"], NeuerKnoten["kind"]> = {
        ort: "place",
        label: "label",
        ecke: "nodix",
        kante: "nodix",
        // Nur das Gebirgsnetz nennt `gipfel` (WI-0245, EDIT-0003 §6); die Kraftlinie rastet dort nie ein.
        gipfel: "nodix",
    };

    return {
        laufend,
        ziele: zieleRef,
        starte,
        nimmHeraus: (bearbeitung, knoten) =>
            schritt(bearbeitung, (form) => {
                const raus = ohneKnoten(form, knoten);
                return "form" in raus ? raus.form : raus.grund;
            }),
        fuegeAn: (bearbeitung, von, nach) =>
            schritt(bearbeitung, (form, linie) => {
                const start = lageVon(form, linie, von);
                const ziel = ziele.find((z) => z.objekt === nach);
                if (start === undefined || ziel === undefined) return "nicht";
                const neu = mitAbschnitt(
                    form,
                    { id: von, ...start },
                    { id: nach, name: ziel.name, kind: ART[ziel.art], x: ziel.at.x, y: ziel.at.y },
                    linie.name,
                );
                return neu ?? "nicht";
            }),
        haengeAb,
        destroy: haengeAb,
    };
}
