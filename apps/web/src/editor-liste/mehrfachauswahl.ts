/**
 * Die Mehrfachauswahl jeder Editor-Liste als reine Rechnung (EDIT-0003 T57; Betreiber 2026-10-19 zu Fassung 5 der Gebiete, wörtlich:
 * „perfekt genau das wollen wir“; Probierseite https://claude.ai/artifact/HhKu7U5yJamSVeq7unPa9L). Die Liste (`editor-liste.vue`) zeigt
 * sie mit `v-model:mehrfach` und `v-model:angehakt`; die Felder der Auswahl stehen in `fenster/sammel.ts`.
 *
 * - Der Umschalter ☑ „Mehrfachauswahl“ steht in der Listenleiste vor Trichter und Sortierung, Vorgabe aus. Aus wählt ein Klick genau
 *   eine Zeile (wie bisher, `gewaehlt`).
 * - An stehen Häkchen an den Zeilen: Ein Klick hakt an oder ab, Umschalt-Klick hakt alle zwischen der zuletzt angeklickten und dieser
 *   an (`klickeHaken`); „Alle n“ hakt alle Treffer an, „✕ Haken lösen“ keine.
 * - 🔴 **Kontext-Zeilen sind nie wählbar** (Fund 2026-10-25: Bei Suche oder Filter bringt der Baum die Vorfahren der Treffer als
 *   Kontext mit, `zusammenhang`. „Alle n“ und Strg+A hakten sie mit an, das Entfernen löschte am 20.10. so Thorwal und Orkreich samt
 *   ihrer Test-Nachbarn mit): Die Reihe für „Alle n“, Strg+A und Umschalt-Bereich kennt nur echte Treffer (`waehlbareReihe`), und ein
 *   Klick auf eine Kontext-Zeile hakt nichts an (`klickeKontext`); einen Haken, der schon da ist, löst er.
 * - Beim Ausschalten bleibt das zuletzt angeklickte gewählt (`ausschalten`).
 * - Umschalt-Klick bei ausgeschalteter Mehrfachauswahl schaltet sie ein und hakt den Bereich vom gewählten Objekt bis zur Zeile an
 *   (`einschaltenMitBereich`; Betreiber 2026-10-20: „die mehrfach auswahl könnte übrigens auch durch gedrückte shift-taste unterstützt
 *   werden“). Auf der Karte nimmt Umschalt-Klick ein Objekt auf oder heraus (`map/mehrfach-markierung.ts`, `umschalteAufKarte`).
 * - Wechselt dabei ein Werkzeugfenster seinen Gegenstand, geht das bisherige ohne Entwurf zu, statt abgelegt zu werden
 *   (`alsMehrfachauswahl`).
 */
import { nextTick } from "vue";
import type { Darstellungszeile } from "./liste-modell";

/** Der Stand der Häkchen: angehakt in der Folge des Anhakens, und die zuletzt angeklickte Zeile (Anker des Bereichs). */
export interface Haken {
    readonly angehakt: readonly string[];
    readonly anker: string | undefined;
}

/**
 * Die Schlüssel der wählbaren Zeilen in der Folge der Liste: Zeilen, die selbst Treffer sind. Gruppenköpfe und die Vorfahren eines
 * Treffers, die der Baum nur als Zusammenhang zeigt (`zusammenhang`), gehören nicht dazu. Sie ist die `reihe` von „Alle n“ (samt
 * Zahl), Strg+A und Umschalt-Bereich.
 */
export function waehlbareReihe(darstellung: readonly Darstellungszeile[]): string[] {
    return darstellung.flatMap((zeile) => (zeile.art === "zeile" && zeile.zusammenhang !== true ? [zeile.key] : []));
}

/**
 * Die gewählte Zeile als erstes Häkchen beim Einschalten (`einschalten`, `einschaltenMitBereich`): nicht, wenn die Liste sie gerade nur als
 * Kontext eines Treffers zeigt. Eine Zeile, die gar nicht in der Darstellung steht (weggefiltert, von der Karte gewählt), bleibt, wie sie war.
 */
export function ohneKontext(key: string | undefined, darstellung: readonly Darstellungszeile[]): string | undefined {
    return key !== undefined && darstellung.some((x) => x.key === key && x.art === "zeile" && x.zusammenhang === true)
        ? undefined
        : key;
}

/** Ein Klick auf eine Kontext-Zeile bei eingeschalteter Mehrfachauswahl: hakt nie an; ein vorhandener Haken wird gelöst. */
export function klickeKontext(angehakt: readonly string[], key: string): readonly string[] {
    return angehakt.includes(key) ? angehakt.filter((x) => x !== key) : angehakt;
}

/**
 * Ein Klick auf eine Zeile bei eingeschalteter Mehrfachauswahl: hakt an oder ab. Mit Umschalt alle Zeilen zwischen Anker und Zeile
 * (in der Folge der Liste, `reihe`) an; fehlt der Anker in der Reihe, wie ein Klick ohne Umschalt.
 */
export function klickeHaken(stand: Haken, key: string, umschalt: boolean, reihe: readonly string[]): Haken {
    const von = stand.anker === undefined ? -1 : reihe.indexOf(stand.anker);
    const bis = reihe.indexOf(key);
    if (umschalt && von >= 0 && bis >= 0) {
        const bereich = reihe.slice(Math.min(von, bis), Math.max(von, bis) + 1);
        return { angehakt: [...stand.angehakt, ...bereich.filter((x) => !stand.angehakt.includes(x))], anker: key };
    }
    const angehakt = stand.angehakt.includes(key) ? stand.angehakt.filter((x) => x !== key) : [...stand.angehakt, key];
    return { angehakt, anker: key };
}

/** „Alle n“: alle Treffer angehakt, die schon angehakten zuerst. */
export function alleAnhaken(angehakt: readonly string[], reihe: readonly string[]): string[] {
    return [...angehakt, ...reihe.filter((x) => !angehakt.includes(x))];
}

/** Ausschalten: gewählt bleibt das zuletzt angeklickte, wenn es angehakt ist, sonst das erste angehakte; ohne Häkchen keins. */
export function ausschalten(angehakt: readonly string[], zuletzt: string | undefined): string[] {
    if (zuletzt !== undefined && angehakt.includes(zuletzt)) return [zuletzt];
    return angehakt.length > 0 ? [angehakt[0]!] : [];
}

let handgriffe = 0;

/**
 * Ein Handgriff der Mehrfachauswahl (Haken, „Alle n“, „✕ Haken lösen“, Ausschalten). Wechselt dabei ein Werkzeugfenster seinen
 * Gegenstand (D19), geht das bisherige ohne Entwurf zu, statt als leerer Eintrag unter „Offene Bearbeitungen“ zu landen; mit Entwurf
 * wird es abgelegt wie immer (Editor-Orchestrierung 2026-10-19 zu Fund 2 der Stage-Probe der Gebiete). `werkzeugfenster.oeffneAnStelle`
 * fragt `imMehrfachauswahlHandgriff`, so bekommt es jedes Werkzeug ohne eigene Anbindung. 🪤 Es gilt bis nach dem nächsten Durchlauf
 * von Vue: Ein Werkzeug, das mit `watch` auf die Häkchen hört (die Gebiete öffnen ein einzelnes am Fenster), wechselt erst dort.
 */
export function alsMehrfachauswahl(tu: () => void): void {
    handgriffe += 1;
    try {
        tu();
    } finally {
        void nextTick(() => {
            handgriffe -= 1;
        });
    }
}

/** Läuft gerade ein Handgriff der Mehrfachauswahl (`alsMehrfachauswahl`)? */
export const imMehrfachauswahlHandgriff = (): boolean => handgriffe > 0;

/** Umschalt-Klick bei ausgeschalteter Mehrfachauswahl: einschalten und den Bereich vom gewählten Objekt bis zur Zeile anhaken. */
export function einschaltenMitBereich(
    gewaehlt: string | undefined,
    key: string,
    reihe: readonly string[],
): readonly string[] {
    return klickeHaken({ angehakt: einschalten(gewaehlt), anker: gewaehlt }, key, true, reihe).angehakt;
}

/** Ein Umschalt-Klick auf der Karte: aufnehmen oder herausnehmen; aus eingeschaltet mit dem bisher gewählten als erstem. */
export function umschalteAufKarte(
    stand: { readonly an: boolean; readonly angehakt: readonly string[] },
    gewaehlt: string | undefined,
    id: string,
): string[] {
    const vorher = stand.an ? stand.angehakt : einschalten(gewaehlt);
    return vorher.includes(id) ? vorher.filter((x) => x !== id) : [...vorher, id];
}

/** Einschalten: Was gewählt war, ist das erste Häkchen. */
export function einschalten(gewaehlt: string | undefined): string[] {
    return gewaehlt === undefined ? [] : [gewaehlt];
}
