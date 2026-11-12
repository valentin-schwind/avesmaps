import { shallowRef, type ShallowRef } from "vue";
import type { ReisebildKarte, ReisebilderAntwort } from "@avesmaps3d/shared";
import {
    liesAusgeblendet,
    liesOhneKi,
    merkeAusgeblendet,
    merkeOhneKi,
    ohneKiZeigbar,
    type OhneKiSpeicher,
} from "./ohne-ki";

/**
 * Der Zustand der Reisebilder im Browser (WI-0272 S4, Aufgabe 25): was die Karte, der Knopf, die Leiste und die Bildansicht gemeinsam wissen. Ohne Karte und ohne DOM, damit Vitest ihn
 * ohne Browser prüft; die Karte (`reisebilder-karte.ts`) schreibt die Daten hinein und meldet sich über `verbindeKarte` an, die Oberfläche liest und stellt.
 *
 * - 🔴 **Alle Daten in `shallowRef`, nie in `ref`:** Was in die Karte geht (Quelldaten, Bilder, `postMessage` an den Worker), darf kein Vue-Proxy sein (`DataCloneError`). Hier liegen nur
 *   flache Listen, die als Ganzes ersetzt werden; geändert wird nie an Ort und Stelle.
 * - **`imBild`** sind die Bilder, die in der freien Fläche der Karte liegen, von West nach Ost (`ordneWestOst`): Die feste Reihenfolge lässt beim Verschieben der Karte Bilder in der Leiste nur
 *   kommen und gehen, statt sie umzusortieren (Probierseite `imAusschnitt`).
 * - **Schließen der Leiste** leert Markierung und Hervorhebung (Probierseite `leiste`): Beides gehört zu einer offenen Leiste.
 * - **Die Filter der Leiste** (Vali 2026-11-03, Probierseite Fassung 2): `bilder` ist immer schon gefiltert, darum folgen Karte, Knopf, Leiste und Bildansicht von selbst. „Ohne KI“ bleibt gemerkt (`ohne-ki.ts`), auch
 *   über `leere` hinweg. „Meine“ gilt nur für diese Seite: `bilder` sind dann die eigenen Karten, und `imBild` nennt sie alle, wo auch immer sie liegen (die Antwort des Abrufs läuft nebenher weiter).
 * - **„Reisebilder ausblenden“** (Vali 2026-11-04: „sodass sie gar nicht auf der karte sichtbar sind“): Nur die Karte zeichnet dann keine Symbole mehr; `bilder` und `imBild` bleiben, also auch Kacheln, Zahl und
 *   Bildansicht. Gemerkt wie „Ohne KI“, auch über `leere` hinweg.
 */

/** Die Ordnung der Leiste: von West nach Ost, bei gleichem x von Nord nach Süd (Karte: y wächst nach Norden); zuletzt die Kennung, damit sie sich nie vertauscht. */
export function ordneWestOst<
    T extends { readonly id: string; readonly lage: { readonly x: number; readonly y: number } },
>(bilder: readonly T[]): T[] {
    return [...bilder].sort(
        (a, b) => a.lage.x - b.lage.x || b.lage.y - a.lage.y || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

/** Die Bildansicht: die Bilder, in denen sie blättert, und die Stelle des gezeigten. */
export interface Bildansicht {
    readonly liste: readonly string[];
    readonly stelle: number;
}

/** Was die Karte der Oberfläche anbietet (`verbindeKarte`). */
export interface KartenGriff {
    /** Wo das Symbol des Bildes am Schirm steht (Fensterkoordinaten); `undefined`, wenn es keins hat. Die Linie der Leiste endet dort. */
    schirmVon(id: string): { readonly x: number; readonly y: number } | undefined;
    /** Zum Bild fliegen und sein Symbol kurz ringen („Auf der Karte zeigen“). `lage`: wohin, wenn das Bild noch nicht geladen ist (das Panel im Ortseditor). */
    zeige(id: string, lage?: { readonly x: number; readonly y: number }): void;
    /** Den Vorrat des Abrufs leeren und neu fragen (ein Bild fehlt in Wirklichkeit). */
    neuLaden?(): void;
    /** Ein Schalter der Leiste hat `bilder` oder das Ausblenden geändert: `imBild` und die Bündel neu rechnen. */
    filterGeaendert?(): void;
    /** Alle Bilder der Gruppe (Symbol), in der das Bild liegt; die Leiste hebt sie gemeinsam hervor. */
    gruppeVon?(id: string): readonly string[];
    /** Die Mitte der freien Fläche als Stelle in Karteneinheiten (die Leiste: „Bild machen“); `undefined`, solange die Karte sie nicht kennt. */
    mitteFrei?(): { readonly x: number; readonly y: number } | undefined;
}

/** Wer hervorhebt: die Kachel der Leiste oder das Symbol der Karte. */
export type HervorQuelle = "kachel" | "karte";

const LEER: ReadonlySet<string> = new Set();

export interface ReisebilderZustand {
    /** Zeigt der Server Reisebilder überhaupt (Schalter `media.role.photobox`)? Bis zur ersten Antwort: nein. */
    readonly an: ShallowRef<boolean>;
    /** Was Karte und Bildansicht zeigen: alle Bilder der letzten Antwort (der Ausschnitt mit Rand) oder, bei „Meine“, die eigenen; immer nach den Filtern der Leiste. */
    readonly bilder: ShallowRef<readonly ReisebildKarte[]>;
    readonly gekappt: ShallowRef<boolean>;
    /** Was die Leiste zeigt: die Bilder in der freien Fläche der Karte, von West nach Ost; bei „Meine“ alle eigenen. */
    readonly imBild: ShallowRef<readonly ReisebildKarte[]>;
    /** Der Filter „Ohne KI“; gilt auch für den Kopf der Infobox. */
    readonly ohneKi: ShallowRef<boolean>;
    /** Der Filter „Meine Reisebilder“. */
    readonly nurMeine: ShallowRef<boolean>;
    /** „Reisebilder ausblenden“: keine Symbole auf der Karte; Knopf, Leiste und Bildansicht bleiben. */
    readonly ausgeblendet: ShallowRef<boolean>;
    readonly leisteOffen: ShallowRef<boolean>;
    readonly markiert: ShallowRef<ReadonlySet<string>>;
    readonly hervor: ShallowRef<string | undefined>;
    /** Woher die Hervorhebung kommt: Nur die einer Kachel zieht die Linie zum Symbol (die vom Symbol hebt Kacheln hervor, mehr nicht). */
    readonly hervorQuelle: ShallowRef<HervorQuelle | undefined>;
    readonly ansicht: ShallowRef<Bildansicht | undefined>;
    setzeAntwort(antwort: ReisebilderAntwort): void;
    setzeImBild(liste: readonly ReisebildKarte[]): void;
    setzeOhneKi(an: boolean): void;
    setzeMeine(an: boolean): void;
    setzeAusgeblendet(an: boolean): void;
    /** Die eigenen veröffentlichten Bilder, sobald ihr Stand da ist (`reisebilder-meine.ts`). */
    setzeMeineKarten(karten: readonly ReisebildKarte[]): void;
    setzeLeiste(offen: boolean): void;
    markiere(ids: readonly string[]): void;
    setzeHervor(id: string | undefined, quelle?: HervorQuelle): void;
    /** Die Bildansicht auf `id` öffnen; `liste` ist die Folge, in der sie blättert (ohne: die Bilder im Bild). */
    oeffneAnsicht(id: string, liste?: readonly string[]): void;
    schliesseAnsicht(): void;
    /** Kachel 404 (oder jedes Bild, das es nicht mehr gibt): raus aus allen Listen, der Abruf fragt neu. */
    vergissBild(id: string): void;
    /** Die Karte meldet sich an; gibt das Abmelden zurück. */
    verbindeKarte(griff: KartenGriff): () => void;
    schirmVon(id: string): { readonly x: number; readonly y: number } | undefined;
    zeige(id: string, lage?: { readonly x: number; readonly y: number }): void;
    /** Neu fragen, ohne den Vorrat abzuwarten (ein Bild kam hinzu oder fiel weg, `reisebilder-frisch.ts`). Leise: Bilder kommen einfach dazu. */
    frisch(): void;
    /** Die Bilder der Gruppe, in der `id` auf der Karte liegt (ohne Karte: nur `id`). */
    gruppeVon(id: string): readonly string[];
    mitteFrei(): { readonly x: number; readonly y: number } | undefined;
    /** Alles zurück, wie vor dem ersten Abruf. Die Verbindung zur Karte bleibt. */
    leere(): void;
}

export function createReisebilderZustand(speicher?: OhneKiSpeicher): ReisebilderZustand {
    /** Zeigt der Server Reisebilder überhaupt (Schalter `media.role.photobox`)? Bis zur ersten Antwort: nein. */
    const an: ShallowRef<boolean> = shallowRef(false);
    /** Was Karte und Bildansicht zeigen, nach den Filtern der Leiste. */
    const bilder: ShallowRef<readonly ReisebildKarte[]> = shallowRef([]);
    const ohneKi: ShallowRef<boolean> = shallowRef(liesOhneKi(speicher));
    const nurMeine: ShallowRef<boolean> = shallowRef(false);
    const ausgeblendet: ShallowRef<boolean> = shallowRef(liesAusgeblendet(speicher));
    /** Die letzte Antwort des Abrufs, ungefiltert: Das Ausschalten eines Filters braucht keine neue Anfrage. */
    let antwortBilder: readonly ReisebildKarte[] = [];
    let antwortGekappt = false;
    let meineKarten: readonly ReisebildKarte[] = [];
    const gekappt: ShallowRef<boolean> = shallowRef(false);
    /** Die Bilder in der freien Fläche der Karte, von West nach Ost. */
    const imBild: ShallowRef<readonly ReisebildKarte[]> = shallowRef([]);
    const leisteOffen: ShallowRef<boolean> = shallowRef(false);
    const markiert: ShallowRef<ReadonlySet<string>> = shallowRef(LEER);
    const hervor: ShallowRef<string | undefined> = shallowRef(undefined);
    const hervorQuelle: ShallowRef<HervorQuelle | undefined> = shallowRef(undefined);
    const ansicht: ShallowRef<Bildansicht | undefined> = shallowRef(undefined);
    let griff: KartenGriff | undefined;
    /** Bilder, deren Datei fehlt (404): Sie kommen auch mit der nächsten Antwort nicht wieder, sonst fragte die Karte im Kreis (Kachel fehlt, Abruf neu, Bild wieder da, Kachel fehlt …). */
    const vergessen = new Set<string>();

    const stelleBilder = (): void => {
        // 🔴 `an: false` heißt nichts zeigen, auch nichts Eigenes.
        const quelle = !an.value ? [] : nurMeine.value ? meineKarten : antwortBilder;
        bilder.value = ohneKi.value ? quelle.filter((b) => ohneKiZeigbar(b.entstehung)) : quelle;
        gekappt.value = antwortGekappt && !nurMeine.value;
    };

    const setzeAntwort = (antwort: ReisebilderAntwort): void => {
        an.value = antwort.an;
        antwortBilder = antwort.an ? antwort.bilder.filter((b) => !vergessen.has(b.id)) : [];
        antwortGekappt = antwort.an && antwort.gekappt;
        stelleBilder();
        if (!antwort.an) imBild.value = [];
    };

    const setzeImBild = (liste: readonly ReisebildKarte[]): void => {
        imBild.value = ordneWestOst(liste);
    };

    const setzeLeiste = (offen: boolean): void => {
        leisteOffen.value = offen;
        if (!offen) {
            markiert.value = LEER;
            hervor.value = undefined;
            hervorQuelle.value = undefined;
        }
    };

    const markiere = (ids: readonly string[]): void => {
        markiert.value = new Set(ids);
    };

    const setzeHervor = (id: string | undefined, quelle: HervorQuelle = "karte"): void => {
        hervor.value = id;
        hervorQuelle.value = id === undefined ? undefined : quelle;
    };

    /** Ein Filter hat sich geändert: Was nicht mehr gezeigt wird, verliert auch Markierung und Hervorhebung; die Karte rechnet die freie Fläche und die Bündel neu. */
    const nachFilter = (): void => {
        stelleBilder();
        const da = new Set(bilder.value.map((b) => b.id));
        imBild.value = nurMeine.value ? ordneWestOst(bilder.value) : imBild.value.filter((b) => da.has(b.id));
        if ([...markiert.value].some((id) => !da.has(id)))
            markiert.value = new Set([...markiert.value].filter((id) => da.has(id)));
        if (hervor.value !== undefined && !da.has(hervor.value)) setzeHervor(undefined);
        griff?.filterGeaendert?.();
    };

    const setzeOhneKi = (neu: boolean): void => {
        ohneKi.value = neu;
        merkeOhneKi(neu, speicher);
        nachFilter();
    };

    const setzeMeine = (neu: boolean): void => {
        nurMeine.value = neu;
        meineKarten = [];
        nachFilter();
    };

    const setzeAusgeblendet = (neu: boolean): void => {
        ausgeblendet.value = neu;
        merkeAusgeblendet(neu, speicher);
        griff?.filterGeaendert?.();
    };

    const setzeMeineKarten = (karten: readonly ReisebildKarte[]): void => {
        meineKarten = karten.filter((b) => !vergessen.has(b.id));
        if (nurMeine.value) nachFilter();
    };

    const oeffneAnsicht = (id: string, liste?: readonly string[]): void => {
        const quelle = liste ?? imBild.value.map((b) => b.id);
        const stelle = quelle.indexOf(id);
        ansicht.value = stelle >= 0 ? { liste: quelle, stelle } : { liste: [id], stelle: 0 };
    };

    const schliesseAnsicht = (): void => {
        ansicht.value = undefined;
    };

    /** Kachel 404 (oder jedes Bild, das es nicht mehr gibt): raus aus allen Listen und neu fragen. */
    const vergissBild = (id: string): void => {
        vergessen.add(id);
        antwortBilder = antwortBilder.filter((b) => b.id !== id);
        meineKarten = meineKarten.filter((b) => b.id !== id);
        bilder.value = bilder.value.filter((b) => b.id !== id);
        imBild.value = imBild.value.filter((b) => b.id !== id);
        if (markiert.value.has(id)) markiert.value = new Set([...markiert.value].filter((m) => m !== id));
        if (hervor.value === id) setzeHervor(undefined);
        const offen = ansicht.value;
        if (offen !== undefined) {
            const index = offen.liste.indexOf(id);
            if (index >= 0) {
                const liste = offen.liste.filter((eintrag) => eintrag !== id);
                if (liste.length === 0) ansicht.value = undefined;
                else
                    ansicht.value = {
                        liste,
                        stelle: Math.min(index < offen.stelle ? offen.stelle - 1 : offen.stelle, liste.length - 1),
                    };
            }
        }
        griff?.neuLaden?.();
    };

    const verbindeKarte = (neu: KartenGriff): (() => void) => {
        griff = neu;
        return () => {
            if (griff === neu) griff = undefined;
        };
    };

    /** Alles zurück, wie vor dem ersten Abruf (die Karte verlässt die Standardansicht). Die Verbindung zur Karte bleibt. */
    const leere = (): void => {
        an.value = false;
        bilder.value = [];
        antwortBilder = [];
        antwortGekappt = false;
        meineKarten = [];
        nurMeine.value = false;
        gekappt.value = false;
        imBild.value = [];
        leisteOffen.value = false;
        markiert.value = LEER;
        hervor.value = undefined;
        hervorQuelle.value = undefined;
        ansicht.value = undefined;
    };

    return {
        an,
        bilder,
        gekappt,
        imBild,
        ohneKi,
        nurMeine,
        ausgeblendet,
        leisteOffen,
        markiert,
        hervor,
        hervorQuelle,
        ansicht,
        setzeAntwort,
        setzeImBild,
        setzeOhneKi,
        setzeMeine,
        setzeAusgeblendet,
        setzeMeineKarten,
        setzeLeiste,
        markiere,
        setzeHervor,
        oeffneAnsicht,
        schliesseAnsicht,
        vergissBild,
        verbindeKarte,
        schirmVon: (id: string) => griff?.schirmVon(id),
        zeige: (id: string, lage?: { readonly x: number; readonly y: number }): void =>
            lage === undefined ? griff?.zeige(id) : griff?.zeige(id, lage),
        frisch: (): void => griff?.neuLaden?.(),
        gruppeVon: (id: string): readonly string[] => griff?.gruppeVon?.(id) ?? [id],
        mitteFrei: () => griff?.mitteFrei?.(),
        leere,
    };
}

/** Das Einzelstück der Seite. */
export const reisebilder: ReisebilderZustand = createReisebilderZustand();
