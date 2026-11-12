import { computed, shallowRef, type ComputedRef, type InjectionKey, type ShallowRef } from "vue";
import type { SearchLeuchtAnfrage, SearchLeuchten } from "@avesmaps3d/shared";
import {
    leuchtetEtwas,
    type SuchLeuchtenBild,
    type SuchLeuchtenFarbe,
    type SuchLeuchtenTeil,
} from "../map/such-leuchten";
import { vereinigeLeuchten, vereinigtSchluessel } from "./leuchten-vereinigen";
import { fetchLeuchten, leuchtenUrl } from "./search-client";

/**
 * Der Zustand des Leuchtens eines Suchtreffers (WI-0257, S3b): welche Anfrage gerade auf der Karte leuchtet und was der Server dazu antwortete. Die Karte liest `bild` (der Stil hängt es an,
 * `map/such-leuchten.ts`), das Panel des Eintrags liest `aktiv` (welcher Chip „Wo genau?“ gerade gilt) und ruft `zeige`.
 *
 * - **Eine Frage zur Zeit:** Jede neue bricht die vorige ab; eine verspätete Antwort ersetzt nie eine neuere.
 * - **Es endet** mit `beende`: bei einem Klick in die Karte, bei einer neuen Suche und mit dem Panel des Eintrags (`app.vue`).
 * - **Kein Treffer, kein Leuchten:** Eine Antwort ohne etwas Sichtbares (der Eintrag hat keinen Ort auf der Karte, die Art ist ausgeblendet) lässt nichts stehen.
 */
export interface SuchLeuchtenSteuerung {
    /** Was leuchtet; `undefined`, wo nichts leuchtet. */
    readonly bild: Readonly<ShallowRef<SuchLeuchtenBild | undefined>>;
    /** Der Schlüssel der Anfrage, die gerade leuchtet (`leuchtenUrl`); `undefined`, wo nichts leuchtet. */
    readonly aktiv: ComputedRef<string | undefined>;
    /** Lässt die Anfrage leuchten und gibt die Antwort zurück (für den Flug der Kamera); `undefined`, wo es nichts gibt oder die Frage überholt wurde. */
    zeige(anfrage: SearchLeuchtAnfrage): Promise<SearchLeuchten | undefined>;
    /**
     * Lässt mehrere Anfragen ZUSAMMEN leuchten (WI-0257 S5, „Vorkommen unterwegs“ mit Mehrfachauswahl): die Vereinigung ihrer Antworten
     * (`leuchten-vereinigen.ts`), `aktiv` ist dann `vereinigtSchluessel`. Die Antworten merkt sie sich je Adresse: Kommt ein Eintrag dazu, fragt sie nur
     * nach ihm, und stehen alle schon da, leuchtet die Vereinigung noch im selben Zug (ein Öffnen der Infobox, das das Leuchten beendet, flackert dann nicht).
     * Ohne Kamera; eine leere Liste beendet das Leuchten.
     *
     * Mit `farben` (je Anfrage an derselben Stelle: Farbe, Name, Kategorie; WI-0257 S5) leuchtet jedes Vorkommen in seiner Farbe und trägt seinen Namen
     * (`SuchLeuchtenBild.teile`, `map/vorkommen-leuchten.ts`); ohne sie golden wie die Suche.
     */
    zeigeVereinigt(
        anfragen: readonly SearchLeuchtAnfrage[],
        farben?: readonly SuchLeuchtenFarbe[],
    ): Promise<SearchLeuchten | undefined>;
    /**
     * Die Antwort zu einer Anfrage, ohne sie leuchten zu lassen: gemerkt aus der Vereinigung oder einmal geholt (und dann gemerkt); `undefined`, wo es keine gibt.
     * Für den Flug zu einem Vorkommen, dessen Infobox „Vorkommen unterwegs“ öffnet (WI-0257 S5).
     */
    leuchtenVon(anfrage: SearchLeuchtAnfrage): Promise<SearchLeuchten | undefined>;
    /** Beendet das Leuchten und bricht eine laufende Frage ab; `true`, wenn etwas leuchtete. */
    beende(): boolean;
}

/**
 * Was die Oberfläche vom Leuchten braucht: den Zustand (welcher Chip gilt, was leuchtet) und `waehle`, das eine Anfrage leuchten lässt UND die Kamera hinfliegen lässt (`app.vue`). Das Panel des
 * Eintrags holt es sich per `inject`, statt dass `app.vue` es durch das Infopanel reicht.
 *
 * `zeige`, `zeigeVereinigt` und `beende` sind dieselben Hände ohne Flug: „Vorkommen unterwegs“ in den Routendetails (WI-0257 S4, S5) lässt die gewählten Einträge leuchten
 * und beendet das Leuchten wieder; wohin die Kamera dort fliegt, entscheidet die Auswahl selbst (`unterwegs-auswahl.ts`, mit `leuchtenVon`).
 */
export interface SuchLeuchtenZugang extends Pick<
    SuchLeuchtenSteuerung,
    "bild" | "aktiv" | "zeige" | "zeigeVereinigt" | "leuchtenVon" | "beende"
> {
    waehle(anfrage: SearchLeuchtAnfrage): void;
}
export const SUCH_LEUCHTEN_ZUGANG: InjectionKey<SuchLeuchtenZugang> = Symbol("such-leuchten-zugang");

/**
 * Mehrere Anfragen desselben Vorkommens (seine Gegenden an der Route, Landschaften und Gebiete getrennt; WI-0257 S5) sind auf der Karte EIN Teil: eine Farbe, ein Name,
 * ihre Antworten vereinigt. Die Reihenfolge bleibt die der Wahl.
 */
function jeVorkommen(teile: readonly SuchLeuchtenTeil[]): SuchLeuchtenTeil[] {
    const nachId = new Map<string, SuchLeuchtenTeil[]>();
    for (const teil of teile) {
        const liste = nachId.get(teil.id);
        if (liste === undefined) nachId.set(teil.id, [teil]);
        else liste.push(teil);
    }
    return [...nachId.values()].map((liste) => {
        const erstes = liste[0] as SuchLeuchtenTeil;
        if (liste.length === 1) return erstes;
        return { ...erstes, leuchten: vereinigeLeuchten(liste.map((teil) => teil.leuchten)) ?? erstes.leuchten };
    });
}

/** So viele Antworten merkt sich die Vereinigung (je Adresse, die älteste fällt zuerst): eine Reise trägt selten mehr gewählte Einträge. */
const VORRAT = 48;

export function createSuchLeuchten(): SuchLeuchtenSteuerung {
    const bild = shallowRef<SuchLeuchtenBild | undefined>(undefined);
    const schluessel = shallowRef<string | undefined>(undefined);
    let frage: AbortController | undefined;
    let runde = 0;
    /** Die Antworten der Vereinigung je Adresse, in der Reihenfolge ihres letzten Gebrauchs. */
    const vorrat = new Map<string, SearchLeuchten>();
    const merke = (adresse: string, antwort: SearchLeuchten): void => {
        vorrat.delete(adresse);
        vorrat.set(adresse, antwort);
        while (vorrat.size > VORRAT) vorrat.delete(vorrat.keys().next().value as string);
    };
    /**
     * Setzt die Vereinigung der gemerkten Antworten; `undefined`, wo keine sichtbar ist. Mit `farben` dazu jedes Vorkommen einzeln in seiner Farbe; eines,
     * dessen Art ausgeblendet ist oder das nichts zeigt, fehlt dort (wie in der Vereinigung).
     */
    function setzeVereinigt(
        adressen: readonly string[],
        key: string,
        farben: readonly SuchLeuchtenFarbe[] | undefined,
    ): SearchLeuchten | undefined {
        const antworten = adressen.map((adresse) => vorrat.get(adresse)).filter((a) => a !== undefined);
        const vereint = vereinigeLeuchten(antworten);
        if (vereint === undefined || vereint.pausiert) {
            bild.value = undefined;
            schluessel.value = undefined;
            return undefined;
        }
        const teile =
            farben === undefined
                ? undefined
                : jeVorkommen(
                      adressen.flatMap((adresse, stelle): SuchLeuchtenTeil[] => {
                          const antwort = vorrat.get(adresse);
                          const farbe = farben[stelle];
                          if (
                              antwort === undefined ||
                              farbe === undefined ||
                              antwort.pausiert ||
                              !leuchtetEtwas(antwort)
                          )
                              return [];
                          return [{ ...farbe, id: antwort.begriff.eintrag ?? adresse, leuchten: antwort }];
                      }),
                  );
        bild.value = teile === undefined ? { leuchten: vereint } : { leuchten: vereint, teile };
        schluessel.value = key;
        return vereint;
    }
    return {
        bild,
        aktiv: computed(() => schluessel.value),
        async zeige(anfrage) {
            frage?.abort();
            const eigene = new AbortController();
            frage = eigene;
            runde += 1;
            const meine = runde;
            const key = leuchtenUrl(anfrage);
            try {
                const antwort = await fetchLeuchten(anfrage, eigene.signal);
                if (meine !== runde) return undefined;
                if (antwort === null || antwort.pausiert) {
                    bild.value = undefined;
                    schluessel.value = undefined;
                    return undefined;
                }
                bild.value = { leuchten: antwort };
                schluessel.value = key;
                return antwort;
            } catch (fehler) {
                if (eigene.signal.aborted || meine !== runde) return undefined;
                // Sichtbar, nicht verschluckt (Kap. 2.16): Das Leuchten bleibt dann aus.
                console.error("Leuchten fehlgeschlagen", fehler);
                bild.value = undefined;
                schluessel.value = undefined;
                return undefined;
            }
        },
        zeigeVereinigt(anfragen, farben) {
            frage?.abort();
            frage = undefined;
            runde += 1;
            const meine = runde;
            if (anfragen.length === 0) {
                bild.value = undefined;
                schluessel.value = undefined;
                return Promise.resolve(undefined);
            }
            const key = vereinigtSchluessel(anfragen);
            const adressen = anfragen.map(leuchtenUrl);
            for (const adresse of adressen) {
                const gemerkt = vorrat.get(adresse);
                if (gemerkt !== undefined) merke(adresse, gemerkt);
            }
            const fehlend = adressen.filter((adresse, at) => !vorrat.has(adresse) && adressen.indexOf(adresse) === at);
            // Alles gemerkt: noch im selben Zug, ohne auf eine Antwort zu warten.
            if (fehlend.length === 0) return Promise.resolve(setzeVereinigt(adressen, key, farben));
            const eigene = new AbortController();
            frage = eigene;
            return (async () => {
                try {
                    // Nacheinander, nicht zugleich: Die Route rechnet je Prozess nur wenige Anfragen auf einmal (503 `busy`).
                    for (const adresse of fehlend) {
                        const anfrage = anfragen[adressen.indexOf(adresse)] as SearchLeuchtAnfrage;
                        const antwort = await fetchLeuchten(anfrage, eigene.signal);
                        if (meine !== runde) return undefined;
                        if (antwort !== null) merke(adresse, antwort);
                    }
                    return setzeVereinigt(adressen, key, farben);
                } catch (fehler) {
                    if (eigene.signal.aborted || meine !== runde) return undefined;
                    console.error("Leuchten fehlgeschlagen", fehler);
                    bild.value = undefined;
                    schluessel.value = undefined;
                    return undefined;
                }
            })();
        },
        async leuchtenVon(anfrage) {
            const adresse = leuchtenUrl(anfrage);
            const gemerkt = vorrat.get(adresse);
            if (gemerkt !== undefined) return gemerkt;
            try {
                const antwort = await fetchLeuchten(anfrage);
                if (antwort === null) return undefined;
                merke(adresse, antwort);
                return antwort;
            } catch (fehler) {
                // Sichtbar, nicht verschluckt (Kap. 2.16): Die Kamera bleibt dann stehen.
                console.error("Leuchten fehlgeschlagen", fehler);
                return undefined;
            }
        },
        beende() {
            frage?.abort();
            frage = undefined;
            runde += 1;
            const war = bild.value !== undefined;
            bild.value = undefined;
            schluessel.value = undefined;
            return war;
        },
    };
}
