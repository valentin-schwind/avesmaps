import { readonly, ref, shallowRef, type Ref, type ShallowRef } from "vue";
import {
    EDITOR_TERRITORY_DISPLAY_URL,
    editorTerritoryHierarchyUrl,
    type ApiErrorBody,
    type EditorLockTarget,
    type EditorTerritoryHierarchy,
    type TerritoryDisplayBody,
    type TerritoryDisplayReceipt,
} from "@avesmaps3d/shared";
import type { EditorSperre } from "../editor-sperre/sperre";
import { sende } from "../fenster/entwurf-senden";
import { createEntwurf } from "../fenster/entwurf-kern";
import type { FormMeldung } from "../map/geometrie/formentwurf";
import { farbhierarchie, normalFarbe, verschiebe } from "./farben";

/**
 * Der Modus „Farben und Zoombänder“ im Reiter „Hierarchie“ (WI-0209 D2, D4; EDIT-0005 §3, §6, §7 D2 und D4, H2; EDIT-0003 T23 Frage 6 und
 * 7, T38; Probierblatt „Herrschaftsgebiete“, `hg-hierarchie.js`, `hg-farben.js`). Ein Entwurf über Zoomspannen und Farben mehrerer
 * Gebiete am Wurzelgebiet des Reiters:
 *
 * - **Beginn** mit der ersten Änderung (Anfasser, ←/→, ⇉, ein Farbfeld, „Farbhierarchie erstellen“). Jede Änderung ist ein Schritt;
 *   ↶ ↷, Strg+Z/Y, Verwerfen und Esc wie im
 *   Formentwurf (der Kern `map/geometrie/entwurf.ts`, F20: Verwerfen lässt den Modus offen).
 * - **Sperre nur der geänderten Gebiete** (Frage 6): Ein Gebiet wird gesperrt, wenn es zum ersten Mal geändert wird (Teil „felder“). Hält
 *   es ein anderer, fällt seine Änderung weg, und der Satz nennt ihn; die übrigen gelten.
 * - **Farben** (D4, H2): Ein Farbfeld ändert die Farbe eines Gebiets, seine Untergebiete ziehen mit derselben Verschiebung mit
 *   (`mitgezogen`, abwählbar); „Farbhierarchie erstellen“ leitet alle Untergebiete der Wurzel nach Legacys Verfahren ab
 *   (`farbenAusHierarchie`, `farben.ts`). Der Baum und die Karte zeigen sie gleich.
 * - **„Fertig“** schreibt EINE Operation `territory.display` mit Spanne und Farbe jedes Gebiets, das vom Start abweicht, je gegen die
 *   Revision aus dem Reiter. Wie in Legacy verlieren die Flächen eines Gebiets mit neuer Spanne ihr eigenes Band (Server,
 *   `territory-display.ts`); die Vorschau im Reiter rechnet ebenso (`mitEntwurf`). Mit einer Spanne leitet danach der Auftrag
 *   `territory_derive` neu ab; Farben brauchen nur eine neue Kachelrevision.
 * - Der Stand hält nur, was vom Start abweicht: Zieht man eine Spanne zurück oder wählt die alte Farbe, ist das Gebiet wieder unverändert.
 * - **Die Zoomspanne aus den Eigenschaften** (T51; Betreiber 2026-10-19 zu Fassung 5, wörtlich: „Zoomspanne: A, Untergebiete ziehen mit,
 *   ein Haken für Farbe und Zoomspanne.“): `spanneGebiet` wie `faerbeGebiet`; mit dem Haken rücken die Spannen aller Untergebiete um so
 *   viele Bänder wie das obere Ende des Gebiets, innerhalb 0–8, und schließen so weiter direkt an (`mitgezogeneSpannen`). Was sich
 *   verschiebt, sagt `spannenFolgen` vor „Fertig“.
 */

/** Eine Zoomspanne; eine fehlende Grenze ist offen (Legacy NULL). */
export interface Spanne {
    readonly min: number | undefined;
    readonly max: number | undefined;
}

/** Was der Entwurf an einem Gebiet ändert: die Spanne, die Farbe oder beides. */
export interface Darstellung {
    readonly spanne?: Spanne;
    readonly farbe?: string;
}

/** Je Gebiet, was der Entwurf ändert, nur was vom Start abweicht. */
export type DarstellungStand = ReadonlyMap<string, Darstellung>;

export interface BandAenderung extends Spanne {
    readonly id: string;
}

export interface FarbAenderung {
    readonly id: string;
    readonly farbe: string;
}

export interface BandLauf {
    readonly wurzel: string;
    readonly name: string;
    /** Was der Entwurf jetzt ändert; ohne beides, womit er begann (für den Titel der Leiste). */
    readonly farben: boolean;
    readonly spannen: boolean;
    /** Die Daten des Reiters vom Start: Revisionen und Spannen, gegen die „Fertig“ schreibt. */
    readonly daten: EditorTerritoryHierarchy;
    readonly phase: "bereit" | "speichert";
    readonly ungespeichert: number;
    readonly zurueck: boolean;
    readonly wieder: boolean;
    readonly frage: boolean;
}

/** Was der Modus meldet: die Sätze des Formentwurfs, „gespeichert“ mit den Namen der geänderten Gebiete und was sich änderte. */
export type ZoombandMeldung =
    | Exclude<FormMeldung, { art: "gespeichert" }>
    | {
          readonly art: "gespeichert";
          readonly namen: readonly string[];
          readonly farben: boolean;
          readonly spannen: boolean;
      };

export type ZoombandAntwort =
    { ok: true; quittung: TerritoryDisplayReceipt } | { ok: false; status: number; fehler: ApiErrorBody["error"] };

export interface ZoombandDaten {
    sende(body: TerritoryDisplayBody): Promise<ZoombandAntwort>;
    /** Der Reiter „Hierarchie“ eines Gebiets, frisch: für eine Farbänderung aus den Eigenschaften ohne laufenden Entwurf (T51). */
    hierarchie?(id: string): Promise<EditorTerritoryHierarchy | undefined>;
}

export interface Zoombaender {
    readonly laufend: Readonly<ShallowRef<BandLauf | undefined>>;
    readonly meldung: Readonly<ShallowRef<ZoombandMeldung | undefined>>;
    /** Der jetzige Stand des Entwurfs; leer ohne Modus. */
    readonly stand: Readonly<ShallowRef<DarstellungStand>>;
    /** Eine Änderung der Spannen am Reiter `daten` mit der Wurzel `wurzel`; ohne laufenden Modus beginnt er. */
    aendere(daten: EditorTerritoryHierarchy, wurzel: string, aenderungen: readonly BandAenderung[]): Promise<void>;
    /** Eine Änderung der Farben, ebenso ein Schritt im selben Entwurf. */
    faerbe(daten: EditorTerritoryHierarchy, wurzel: string, farben: readonly FarbAenderung[]): Promise<void>;
    /**
     * „Untergebiete ziehen mit“ (H2): EIN Schalter für den Reiter „Hierarchie“ und die Eigenschaften (T51). Nur lesbar: Wer das Band-Objekt
     * als Prop hält, meldet die Wahl nach oben (`mitziehen`), umgestellt wird sie beim Besitzer über `ziehtMit`.
     */
    readonly mitziehen: Readonly<Ref<boolean>>;
    /** Stellt den Schalter um; ruft nur der Besitzer des Band-Objekts (`app.vue`). */
    ziehtMit(an: boolean): void;
    /**
     * Die Farbe eines Gebiets aus den Eigenschaften (T51): im laufenden Entwurf, wenn das Gebiet darin steht; ohne Entwurf beginnt einer ab
     * diesem Gebiet. Steht es in einem laufenden Entwurf nicht, sagt die Meldung warum.
     */
    faerbeGebiet(id: string, farbe: string): Promise<void>;
    /** Die Spanne eines Gebiets aus den Eigenschaften (T51, Entscheid A), wie `faerbeGebiet`; mit dem Haken ziehen die Untergebiete mit. */
    spanneGebiet(id: string, spanne: Spanne): Promise<void>;
    /** Die Untergebiete von `id` im laufenden Entwurf mit ihrer Spanne vorher und jetzt; ohne Entwurf oder ohne Spanne an `id` leer. */
    spannenFolgen(id: string): readonly SpannenFolge[];
    zurueck(): void;
    wieder(): void;
    verwerfen(): void;
    fertig(): Promise<void>;
    antworte(verwerfen: boolean): void;
    /** Esc: `true`, wenn der Modus die Taste nahm. */
    abbrechen(): boolean;
    beende(): void;
    destroy(): void;
}

export interface ZoombaenderOptionen {
    readonly daten: ZoombandDaten;
    readonly sperre: Pick<EditorSperre, "nimm" | "gib" | "beiVerlust"> & Partial<Pick<EditorSperre, "bieteFreigabe">>;
    /** Nach dem Schreiben: die Kachelrevision der Quittung (`map.changed`). */
    readonly geaendert?: ((mapRevision: number | undefined) => void) | undefined;
    /** Nach dem Schreiben: Liste, Detail und Reiter neu lesen. */
    readonly gespeichert?: (() => void) | undefined;
    readonly neueKennung?: (() => string) | undefined;
    /** Der Satz, wenn eine Farbe aus den Eigenschaften nicht in den laufenden Entwurf passt (sein Wurzelgebiet `name`). */
    readonly anderswo?: ((name: string) => string) | undefined;
}

const ziel = (id: string): EditorLockTarget => ({ kind: "territory", id });
const gleich = (a: Spanne, b: Spanne): boolean => a.min === b.min && a.max === b.max;
const art = (stand: DarstellungStand): { farben: boolean; spannen: boolean } => ({
    farben: [...stand.values()].some((d) => d.farbe !== undefined),
    spannen: [...stand.values()].some((d) => d.spanne !== undefined),
});

/** Die Farbe eines Gebiets im Entwurf, sonst die aus dem Reiter. */
export function farbeVon(daten: EditorTerritoryHierarchy, stand: DarstellungStand, id: string): string {
    return stand.get(id)?.farbe ?? normalFarbe(daten.territories.find((t) => t.id === id)?.color) ?? "#888888";
}

/** Die Untergebiete eines Gebiets im Reiter, ohne die Glieder darüber. */
function nachfahrenVon(daten: EditorTerritoryHierarchy, id: string): string[] {
    const kinder = new Map<string, string[]>();
    for (const t of daten.territories)
        if (t.parent !== undefined && t.above !== true) kinder.set(t.parent, [...(kinder.get(t.parent) ?? []), t.id]);
    const raus: string[] = [];
    const stapel = [...(kinder.get(id) ?? [])];
    while (stapel.length > 0) {
        const naechste = stapel.shift()!;
        if (raus.includes(naechste)) continue;
        raus.push(naechste);
        stapel.push(...(kinder.get(naechste) ?? []));
    }
    return raus;
}

/**
 * Die Farbe eines Gebiets ändern (H2): das Gebiet selbst und, mit `mitziehen`, jedes Untergebiet um dieselbe Verschiebung, ausgehend
 * von den Farben im Entwurf.
 */
export function mitgezogen(
    daten: EditorTerritoryHierarchy,
    stand: DarstellungStand,
    id: string,
    farbe: string,
    mitziehen: boolean,
): FarbAenderung[] {
    const neu = normalFarbe(farbe) ?? farbe;
    const alt = farbeVon(daten, stand, id);
    const raus: FarbAenderung[] = [{ id, farbe: neu }];
    if (!mitziehen) return raus;
    for (const kind of nachfahrenVon(daten, id))
        raus.push({ id: kind, farbe: verschiebe(farbeVon(daten, stand, kind), alt, neu) });
    return raus;
}

/** Die Spanne eines Gebiets im Entwurf, sonst die aus dem Reiter. */
export function spanneVon(daten: EditorTerritoryHierarchy, stand: DarstellungStand, id: string): Spanne {
    const t = daten.territories.find((g) => g.id === id);
    return stand.get(id)?.spanne ?? { min: t?.minZoom, max: t?.maxZoom };
}

/** Das höchste Band; eine offene obere Grenze reicht bis dahin. */
const OBEN = 8;

/**
 * Die Spanne eines Gebiets ändern (T51, Entscheid A): das Gebiet selbst und, mit `mitziehen`, jedes Untergebiet bis zum Enkel um so viele
 * Bänder wie das obere Ende, ausgehend von den Spannen im Entwurf; innerhalb 0–8, „bis“ nie unter „von“. Eine offene Grenze bleibt offen.
 */
export function mitgezogeneSpannen(
    daten: EditorTerritoryHierarchy,
    stand: DarstellungStand,
    id: string,
    spanne: Spanne,
    mitziehen: boolean,
): BandAenderung[] {
    const raus: BandAenderung[] = [{ id, ...spanne }];
    const delta = (spanne.max ?? OBEN) - (spanneVon(daten, stand, id).max ?? OBEN);
    if (!mitziehen || delta === 0) return raus;
    const rueck = (band: number | undefined): number | undefined =>
        band === undefined ? undefined : Math.max(0, Math.min(OBEN, band + delta));
    for (const kind of nachfahrenVon(daten, id)) {
        const vorher = spanneVon(daten, stand, kind);
        const min = rueck(vorher.min);
        const max = rueck(vorher.max);
        raus.push({ id: kind, min, max: min !== undefined && max !== undefined && max < min ? min : max });
    }
    return raus;
}

/** Eine Zeile der Folgen vor „Fertig“: ein Untergebiet, seine Spanne vom Start und im Entwurf. */
export interface SpannenFolge {
    readonly id: string;
    readonly name: string;
    readonly vorher: Spanne;
    readonly nachher: Spanne;
}

/** Die Untergebiete eines Gebiets im Entwurf mit ihrer Spanne vorher und jetzt (für „Zieht mit“ und „bleiben“ vor „Fertig“). */
export function spannenFolgenIn(daten: EditorTerritoryHierarchy, stand: DarstellungStand, id: string): SpannenFolge[] {
    return nachfahrenVon(daten, id).map((kind) => {
        const t = daten.territories.find((g) => g.id === kind);
        return {
            id: kind,
            name: t?.name ?? "",
            vorher: { min: t?.minZoom, max: t?.maxZoom },
            nachher: spanneVon(daten, stand, kind),
        };
    });
}

/**
 * „Farbhierarchie erstellen“ (D4, Legacys Verfahren): die Untergebiete von `wurzel` aus ihrer Farbe im Entwurf, `abweichung` je Ebene
 * (Index 0 ist Ebene 1), `seed` je Druck auf den Knopf. Die Ebene der Wurzel zählt die Glieder darüber.
 */
export function farbenAusHierarchie(
    daten: EditorTerritoryHierarchy,
    stand: DarstellungStand,
    wurzel: string,
    abweichung: readonly number[],
    seed: number,
): FarbAenderung[] {
    const ebene = daten.territories.filter((t) => t.above === true).length + 1;
    const gebiete = daten.territories
        .filter((t) => t.above !== true && t.id !== wurzel)
        .map((t) => ({ id: t.id, name: t.name, eltern: t.parent }));
    return farbhierarchie({ id: wurzel, farbe: farbeVon(daten, stand, wurzel), ebene }, gebiete, abweichung, seed);
}

export function createZoombaender(optionen: ZoombaenderOptionen): Zoombaender {
    const entwurf = createEntwurf<DarstellungStand>();
    const laufend = shallowRef<BandLauf | undefined>(undefined);
    const meldung = shallowRef<ZoombandMeldung | undefined>(undefined);
    const stand = shallowRef<DarstellungStand>(new Map());
    const mitziehen = ref(true);
    /** Die Gebiete, deren Sperre dieser Modus hält. */
    const gehalten = new Set<string>();
    let speichert = false;
    const neueKennung = optionen.neueKennung ?? (() => globalThis.crypto.randomUUID());

    const nameVon = (id: string): string =>
        laufend.value?.daten.territories.find((t) => t.id === id)?.name ?? laufend.value?.name ?? "";
    const startVon = (daten: EditorTerritoryHierarchy, id: string): Spanne => {
        const t = daten.territories.find((g) => g.id === id);
        return { min: t?.minZoom, max: t?.maxZoom };
    };

    function aktualisiere(): void {
        const lauf = laufend.value;
        if (lauf === undefined) return;
        const lage = entwurf.lage();
        stand.value = entwurf.jetzt() ?? new Map();
        const jetzt = art(stand.value);
        laufend.value = {
            ...lauf,
            ...lage,
            ...(jetzt.farben || jetzt.spannen ? jetzt : {}),
            phase: speichert ? "speichert" : "bereit",
        };
    }

    /** Die Anmeldungen zur Freigabe auf Bitte (WI-0262), je gehaltenes Gebiet eine; alle rufen dasselbe „Fertig“. */
    const angebote = new Map<string, () => void>();
    function biete(id: string): void {
        if (angebote.has(id) || optionen.sperre.bieteFreigabe === undefined) return;
        angebote.set(
            id,
            optionen.sperre.bieteFreigabe(ziel(id), {
                titel: nameVon(id),
                async speichere() {
                    await fertig();
                    if (laufend.value === undefined) return { ok: true };
                    const m = meldung.value;
                    return { ok: false, grund: m?.art === "abgelehnt" ? m.satz : undefined };
                },
            }),
        );
    }
    function ziehZurueck(id: string): void {
        angebote.get(id)?.();
        angebote.delete(id);
    }

    function beende(): void {
        for (const id of gehalten) {
            ziehZurueck(id);
            optionen.sperre.gib(ziel(id));
        }
        gehalten.clear();
        entwurf.leere();
        speichert = false;
        laufend.value = undefined;
        stand.value = new Map();
    }

    const abmelden = optionen.sperre.beiVerlust((verloren) => {
        if (verloren.kind !== "territory" || !gehalten.delete(verloren.id)) return;
        ziehZurueck(verloren.id);
        meldung.value = { art: "verloren", name: nameVon(verloren.id) };
    });

    async function sperreFuer(ids: readonly string[]): Promise<Set<string>> {
        const neu = ids.filter((id) => !gehalten.has(id));
        const ergebnisse = await Promise.all(
            neu.map(async (id) => ({ id, ergebnis: await optionen.sperre.nimm(ziel(id), "felder") })),
        );
        for (const { id, ergebnis } of ergebnisse) {
            if (ergebnis.art === "genommen") {
                gehalten.add(id);
                biete(id);
            } else if (ergebnis.art === "gesperrt")
                meldung.value = { art: "gesperrt", name: nameVon(id), wer: ergebnis.sperre.person.name };
            else meldung.value = { art: "sperrfehler", name: nameVon(id) };
        }
        return new Set(ids.filter((id) => gehalten.has(id)));
    }

    async function fertig(): Promise<void> {
        const lauf = laufend.value;
        if (lauf === undefined || speichert) return;
        const jetzt = entwurf.jetzt() ?? new Map<string, Darstellung>();
        const revision = new Map(lauf.daten.territories.map((t) => [t.id, t.revision]));
        const territories = [...jetzt].flatMap(([id, d]) => {
            const baseRevision = revision.get(id);
            if (baseRevision === undefined) return [];
            const s = d.spanne;
            return [
                {
                    id,
                    baseRevision,
                    ...(s === undefined
                        ? {}
                        : {
                              zoom: {
                                  ...(s.min === undefined ? {} : { minZoom: s.min }),
                                  ...(s.max === undefined ? {} : { maxZoom: s.max }),
                              },
                          }),
                    ...(d.farbe === undefined ? {} : { color: d.farbe }),
                },
            ];
        });
        if (territories.length === 0) {
            beende();
            return;
        }
        speichert = true;
        aktualisiere();
        const antwort = await optionen.daten.sende({ operationId: neueKennung(), territories });
        speichert = false;
        // Geschrieben ist geschrieben: Die Kacheln folgen, auch wenn der Modus inzwischen endete.
        if (antwort.ok) optionen.geaendert?.(antwort.quittung.mapRevision);
        if (laufend.value === undefined) return;
        if (antwort.ok) {
            const namen = territories.map((t) => nameVon(t.id));
            const geschrieben = art(jetzt);
            beende();
            meldung.value = { art: "gespeichert", namen, ...geschrieben };
            optionen.gespeichert?.();
            return;
        }
        aktualisiere();
        if (antwort.status === 409 && antwort.fehler.code === "edit_conflict") {
            const details = antwort.fehler.details as
                { changedBy?: { displayName?: string }; changedAt?: string } | undefined;
            meldung.value = {
                art: "konflikt",
                name: lauf.name,
                wer: details?.changedBy?.displayName,
                wann: details?.changedAt,
            };
            return;
        }
        if (antwort.status === 409 && antwort.fehler.code === "object_locked") {
            const details = antwort.fehler.details as { lock?: { person?: { name?: string } } } | undefined;
            meldung.value = { art: "gesperrt", name: lauf.name, wer: details?.lock?.person?.name ?? "" };
            return;
        }
        meldung.value = { art: "abgelehnt", satz: antwort.fehler.message };
    }

    /** Ein Schritt im Entwurf: die Gebiete `ids` sperren, dann `setze` an jedem freien; ohne laufenden Modus beginnt er. */
    async function schritt(
        daten: EditorTerritoryHierarchy,
        wurzel: string,
        ids: readonly string[],
        beginn: "farben" | "spannen",
        setze: (neu: Map<string, Darstellung>, id: string, start: EditorTerritoryHierarchy) => void,
    ): Promise<void> {
        if (speichert || ids.length === 0) return;
        const lauf = laufend.value;
        if (lauf !== undefined && lauf.wurzel !== wurzel) return;
        if (lauf === undefined) {
            const name = daten.territories.find((t) => t.id === wurzel)?.name ?? "";
            entwurf.beginne(new Map());
            laufend.value = {
                wurzel,
                name,
                farben: beginn === "farben",
                spannen: beginn === "spannen",
                daten,
                phase: "bereit",
                ungespeichert: 0,
                zurueck: false,
                wieder: false,
                frage: false,
            };
        }
        const meiner = laufend.value;
        const frei = await sperreFuer(ids);
        if (laufend.value !== meiner || meiner === undefined) {
            // Der Modus endete, während die Sperren kamen: nichts halten.
            for (const id of frei) {
                ziehZurueck(id);
                optionen.sperre.gib(ziel(id));
            }
            for (const id of frei) gehalten.delete(id);
            return;
        }
        const gilt = ids.filter((id) => frei.has(id));
        if (gilt.length === 0) {
            if (entwurf.lage().ungespeichert === 0 && !entwurf.lage().wieder) beende();
            return;
        }
        const neu = new Map(entwurf.jetzt() ?? []);
        for (const id of gilt) setze(neu, id, meiner.daten);
        entwurf.schritt(neu);
        aktualisiere();
    }

    /** Was vom Start abweicht, bleibt; was ihm gleicht, fällt weg. */
    function setzeDarstellung(neu: Map<string, Darstellung>, id: string, d: Darstellung): void {
        if (d.spanne === undefined && d.farbe === undefined) neu.delete(id);
        else neu.set(id, d);
    }

    async function faerbe(
        daten: EditorTerritoryHierarchy,
        wurzel: string,
        farben: readonly FarbAenderung[],
    ): Promise<void> {
        const je = new Map(farben.map((f) => [f.id, normalFarbe(f.farbe) ?? f.farbe]));
        await schritt(daten, wurzel, [...je.keys()], "farben", (neu, id, start) => {
            const farbe = je.get(id)!;
            const rest = { ...neu.get(id) };
            delete rest.farbe;
            const vorher = normalFarbe(start.territories.find((t) => t.id === id)?.color);
            setzeDarstellung(neu, id, farbe === vorher ? rest : { ...rest, farbe });
        });
    }

    async function aendere(
        daten: EditorTerritoryHierarchy,
        wurzel: string,
        aenderungen: readonly BandAenderung[],
    ): Promise<void> {
        const je = new Map(aenderungen.map((a) => [a.id, a]));
        await schritt(daten, wurzel, [...je.keys()], "spannen", (neu, id, start) => {
            const a = je.get(id)!;
            const spanne: Spanne = { min: a.min, max: a.max };
            const rest = { ...neu.get(id) };
            delete rest.spanne;
            setzeDarstellung(neu, id, gleich(spanne, startVon(start, id)) ? rest : { ...rest, spanne });
        });
    }

    const steht = (daten: EditorTerritoryHierarchy, id: string): boolean =>
        daten.territories.some((t) => t.id === id && t.above !== true && t.revision !== undefined);

    return {
        laufend,
        meldung,
        stand,
        mitziehen: readonly(mitziehen),
        ziehtMit(an) {
            mitziehen.value = an;
        },
        aendere,
        faerbe,
        async faerbeGebiet(id, farbe) {
            if (speichert) return;
            let lauf = laufend.value;
            if (lauf === undefined) {
                const daten = await optionen.daten.hierarchie?.(id);
                if (daten === undefined || !steht(daten, id)) {
                    meldung.value = { art: "ladefehler" };
                    return;
                }
                lauf = laufend.value;
                if (lauf === undefined) {
                    await faerbe(daten, id, mitgezogen(daten, new Map(), id, farbe, mitziehen.value));
                    return;
                }
            }
            if (!steht(lauf.daten, id)) {
                meldung.value = { art: "abgelehnt", satz: optionen.anderswo?.(lauf.name) ?? "" };
                return;
            }
            await faerbe(lauf.daten, lauf.wurzel, mitgezogen(lauf.daten, stand.value, id, farbe, mitziehen.value));
        },
        async spanneGebiet(id, spanne) {
            if (speichert) return;
            let lauf = laufend.value;
            if (lauf === undefined) {
                const daten = await optionen.daten.hierarchie?.(id);
                if (daten === undefined || !steht(daten, id)) {
                    meldung.value = { art: "ladefehler" };
                    return;
                }
                lauf = laufend.value;
                if (lauf === undefined) {
                    await aendere(daten, id, mitgezogeneSpannen(daten, new Map(), id, spanne, mitziehen.value));
                    return;
                }
            }
            if (!steht(lauf.daten, id)) {
                meldung.value = { art: "abgelehnt", satz: optionen.anderswo?.(lauf.name) ?? "" };
                return;
            }
            await aendere(
                lauf.daten,
                lauf.wurzel,
                mitgezogeneSpannen(lauf.daten, stand.value, id, spanne, mitziehen.value),
            );
        },
        spannenFolgen(id) {
            const lauf = laufend.value;
            if (lauf === undefined || stand.value.get(id)?.spanne === undefined) return [];
            return spannenFolgenIn(lauf.daten, stand.value, id);
        },
        zurueck() {
            if (speichert || !entwurf.zurueck()) return;
            aktualisiere();
        },
        wieder() {
            if (speichert || !entwurf.wieder()) return;
            aktualisiere();
        },
        verwerfen() {
            if (speichert || !entwurf.verwerfen()) return;
            aktualisiere();
        },
        fertig,
        antworte(verwerfen) {
            const lauf = laufend.value;
            if (lauf === undefined) return;
            if (entwurf.antworte(verwerfen) === "ende") {
                beende();
                meldung.value = { art: "verworfen", name: lauf.name };
                return;
            }
            aktualisiere();
        },
        abbrechen() {
            if (laufend.value === undefined) return false;
            if (speichert) return true;
            if (entwurf.esc() === "ende") beende();
            else aktualisiere();
            return true;
        },
        beende,
        destroy() {
            beende();
            abmelden();
        },
    };
}

/** Der Schreibweg: `POST /api/editor/territories/display` über den gemeinsamen Weg der Entwürfe (`fenster/entwurf-senden.ts`, O3). */
export function createZoombandDaten(): ZoombandDaten {
    return {
        sende: (body) => sende<TerritoryDisplayReceipt>(EDITOR_TERRITORY_DISPLAY_URL, body),
        async hierarchie(id) {
            try {
                const antwort = await fetch(editorTerritoryHierarchyUrl(id), {
                    cache: "no-store",
                    headers: { accept: "application/json" },
                });
                return antwort.ok ? ((await antwort.json()) as EditorTerritoryHierarchy) : undefined;
            } catch {
                return undefined;
            }
        },
    };
}
