import { computed, ref, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from "vue";
import {
    FELD_HERKUNFT_FELDER,
    type EditorLockKind,
    type MapHistoryEntry,
    type MapHistoryObject,
    type MapHistoryPage,
    type MapHistorySeries,
    type WikiFeldAenderung,
} from "@avesmaps3d/shared";
import { istGrundFeld } from "../aenderungen/aenderung-detail-modell";
import type { RuecknahmeZiel } from "../aenderungen/aenderung-ruecknahme";
import type { SchreibAntwort } from "./entwurf-senden";
import { istQuellenEintrag, istQuellenGegenstand } from "./quellen-verlauf-modell";

/**
 * Der Verlauf eines Objekts im Fenster (gemeinsamer Fensterrumpf, EDIT-0003 §4 „Fensterrumpf: … Verlauf“, G5 „Verlauf mit ↺“, T27 (5)
 * „kein Zurücknehmen-Feld, der Verlauf reicht“, T44; Auftrag der Editor-Orchestrierung 2026-10-17: gemeinsam, erster Nutzer die
 * Kraftlinie). Gehoben aus dem Verlauf des Ortseditors (WI-0128 E17), der seit WI-0265 B6d selbst darauf steht (`ortseditor/ort-verlauf.ts`); seine
 * eigene Darstellung und seine Texte `ortseditor.verlauf.*` sind entfallen. Reine Rechnung mit Vue-Refs, ohne Fenster; die Anzeige ist
 * `entwurf-verlauf.vue`.
 *
 * ## Die Schnittstelle
 *
 * **Ein Anschluss** (`VerlaufsArt<D, B>`) je Objektart sagt, woher der Verlauf kommt, welche Gegenstände einer Operation zum Objekt
 * gehören und wie ↺ als neue Operation der Art geht; alles andere ist für alle gleich. `D` ist der gelesene Stand der Bearbeitung
 * (`VerlaufBearbeitung`, was `bearbeitung.ts` liefert; der Ort reicht eine Sicht auf seine eigene Bearbeitung und liest auch ohne Schreibrecht), `B` der Körper der
 * Operation, die ↺ schreibt (dieselbe wie „Fertig“, mit `reverts`).
 *
 * | Griff | Kraftlinie | Ort (B6d) | Landschaft (D3) | Gebiet (D5) | Weg |
 * |---|---|---|---|---|---|
 * | `url(id)` | `GET /api/editor/powerlines/:id/history` | `…/places/:id/history` | eigene Route | eigene Route | eigene Route |
 * | `gehoert(g, d)` | ein Abschnitt der Linie | der Ort | Landschaft, Teilflächen, Beschriftungen | Gebiet, Flächen | der Weg |
 * | `ruecknahme(e, d, id)` | `powerline.update_line` | `place.update` oder `place.move` | `landscape.update` | `territory.update` | `path.update` |
 * | `schreibe(id, b)` | `POST …/update` | `PATCH`/`POST` | `PATCH …/:id` | … | … |
 * | `feldFolge` | Name, Beschriftung, Beschreibung, Bogen, Enden | die des Formulars | … | … | … |
 *
 * Auf dem Server liest `apps/server/src/editor/history.ts` (je Art eine Funktion, gemeinsam `eintraege`); der Vertrag ist
 * `packages/shared/src/editor-history.ts` (`MapHistoryPage`, seitenweise über `before`, neueste zuerst). Ein Eintrag ist EINE Operation
 * mit allen ihren Gegenständen; gezeigt werden die Felder der Gegenstände, die zum Objekt gehören, alt → neu (gleiche Wechsel an
 * mehreren Gegenständen einmal, etwa der Name an allen Abschnitten einer Linie).
 *
 * **Zustand, Rücknahme-Bezug und Arbeitsserien** (WI-0265 B5a): Jeder Eintrag trägt `status`, `revertedBy` und, wenn er zu einer Arbeitsserie gehört, `series`;
 * die Seite trägt dazu `series[]` (`serien`). Die Anzeige gruppiert sie wie der Reiter „Änderungen“ (`aenderungen/aenderung-modell.ts`) und zeigt das
 * gemeinsame Detail (`aenderungen/aenderung-detail.vue`): dieselbe `operationId`, derselbe Zustand, dieselben Töne für Vorher und Nachher.
 *
 * **Zurücknehmen über den Server** (WI-0265 B5c): Nennt die Art für einen Eintrag eine Adresse (`ruecknahmeZiel`: Derographie, Gipfel, Ort, Weg, Gebiet, Kraftlinie), nimmt das gemeinsame
 * Bauteil `aenderungen/aenderung-ruecknahme.vue` ihn zurück, einzeln oder als ganze Serie: Vorprüfung des Servers, Rückfrage, EINE Rücknahme (`restore-series`), dieselbe
 * wie im Reiter „Änderungen“. Der Anschluss spielt solche Einträge nicht mehr selbst zurück (`ruecknahme` sagt `nicht`). Alles andere behält das ↺ der Art, bis die
 * anderen Familien folgen (B6; Gebiet und Kraftlinie seit B6b). `nachRuecknahme` liest danach Bearbeitung und Verlauf neu.
 *
 * **Herkunft der Wiki-Felder** (WI-0225, Orchestrierung 2026-10-18, A): Eine Art mit Wiki-Feldern protokolliert neben dem Wert die
 * Herkunft als `<feld>Origin` (wie der Ort: `nameOrigin`). Mit `herkunft` (ihre Art in `FELD_HERKUNFT_FELDER`) steht dieses Feld nicht als
 * eigene Zeile im Verlauf, und ↺ nimmt es mit: `wikiRuecknahme` gibt für einen Wert, der vorher dem Wiki folgte, `{ revert: "wiki" }`
 * zurück, sonst den alten Wert. Führt eine Art die Herkunft an eigener Stelle (Gebiete:
 * `territory_detail_field_origin`), nennt sie ihre Wiki-Felder in `herkunftsfelder`. Andere `…Origin`-Felder (etwa `parentOrigin` der
 * Gebiete) bleiben sichtbar.
 *
 * ## Der Ablauf
 *
 * - **Lesen:** erst, wenn die Anzeige ihn zeigt (`lade()`, `entwurf-verlauf.vue` beim Einhängen), danach nach jedem „Fertig“ der
 *   Bearbeitung (Zustand `gespeichert`) und nach dem eigenen ↺; „Ältere Einträge“ holt die nächste Seite. Nennt die Art die Revision des Objekts (`revision`), liest der Verlauf auch
 *   neu, sobald sie sich ändert, etwa nach einem Verschieben auf der Karte, das nicht über „Fertig“ lief (der Ort).
 * - **↺** nimmt EINE Operation zurück, als neue Operation der Art mit `reverts` (Quelle `restore`; nichts wird gelöscht). 🔴 Es geht nur,
 *   solange keine Bearbeitung läuft (T44: kein ungeschriebener Entwurf; der Knopf sagt sonst warum). Steht ein Feld seitdem anders, ist
 *   es ein Konflikt: Der Eintrag nennt die Felder, ↺ geht nicht. Nicht zurücknehmbar (`nicht`): Import, Zurücksetzen der Testwelt,
 *   das Anlegen und was die Art sonst ausschließt.
 * - **Quellen** (WI-0254 §12): Änderungen an den Quellen eines Objekts (`<art>.sources_changed`) sind keine Felder des Objekts. Sie stehen als lesbare Zeilen da und haben ihr eigenes ↺
 *   (`quellen-verlauf-eintrag.vue`, `quellen-verlauf-steuerung.ts`); hier fallen sie aus `felder` heraus, und die Rücknahme des Objekts nimmt sie nicht zurück.
 * - **Geschrieben:** Die Bearbeitung liest den neuen Stand (`neuLesen`), der Verlauf liest neu, `zurueckgenommen(mapRevision)` zeichnet
 *   die Karte neu. **Abgelehnt:** Der Satz des Servers steht am Eintrag.
 */

/** Was ↺ an einem Eintrag täte, gemessen am jetzigen Stand. */
export type Ruecknahme<B> =
    | { readonly art: "geht"; readonly body: B }
    /** Seitdem anders: welche Felder (Feldnamen des Protokolls). */
    | { readonly art: "konflikt"; readonly felder: readonly string[] }
    | { readonly art: "nicht" };

export interface VerlaufsArt<D, B> {
    /** Die Adresse des Verlaufs (ohne `before`). */
    url(id: string): string;
    /** Gehört dieser Gegenstand einer Operation zum Objekt mit dem Stand `d`? */
    gehoert(gegenstand: MapHistoryObject, d: D): boolean;
    /** ↺: der Körper der Operation, die den Eintrag zurücknimmt (mit `reverts`), oder warum nicht. */
    ruecknahme(eintrag: MapHistoryEntry, d: D, operationId: string): Ruecknahme<B>;
    schreibe(id: string, body: B): Promise<SchreibAntwort>;
    /**
     * Die Adresse, unter der der Server diesen Eintrag zurücknimmt (`restore-series`, B5c), oder `undefined`, wenn der Anschluss ihn selbst zurückspielt.
     * Das Gebirge hängt an seiner Landschaft: Nur der Verlauf der Landschaft kennt ihre Kennung `id`.
     */
    ruecknahmeZiel?(eintrag: MapHistoryEntry, id: string): RuecknahmeZiel | undefined;
    /**
     * Der Server hat zurückgenommen (WI-0265 B6b): Die Art nimmt die Quittung auf, bevor Bearbeitung und Verlauf neu lesen. Die Kraftlinie folgt so ihrem neuen Anker, wenn das ↺ den
     * herausgenommen hat, unter dem sie gelesen wurde.
     */
    nachRuecknahme?(quittung: {
        readonly mapRevision?: number | undefined;
        readonly affected?: readonly { readonly kind: string; readonly id: string }[] | undefined;
    }): void;
    /**
     * Die Revision des Objekts im gelesenen Stand (WI-0265 B6d): Ändert sie sich, während der Verlauf gelesen ist, liest er neu. Für Objekte, die auch auf anderem Weg als „Fertig“
     * oder ↺ weiterkommen (der Ort wird auf der Karte verschoben, sein Wiki-Artikel gesynct).
     */
    revision?(d: D): number | undefined;
    /** In welcher Folge die Felder eines Eintrags stehen; die übrigen danach. */
    readonly feldFolge?: readonly string[];
    /** Felder des Protokolls, die keine Zeile des Verlaufs sind (der Ort: `staetten`, die Liste der Beziehungen, die eine Operation bewegt hat; was geschah, sagt die Zusammenfassung). */
    readonly ohneFelder?: readonly string[];
    /** Die Art der Wiki-Felder (`FELD_HERKUNFT_FELDER`): Ihre Herkunftsfelder `<feld>Origin` stehen nicht als eigene Zeile da. */
    readonly herkunft?: EditorLockKind;
    /**
     * Weitere Wiki-Felder, deren Herkunft die Art an eigener Stelle führt (Gebiete: die 17 Detailfelder in
     * `territory_detail_field_origin`, nicht im Katalog): Auch ihr `<feld>Origin` steht nicht als eigene Zeile da.
     */
    readonly herkunftsfelder?: readonly string[];
}

/**
 * Ist `feld` das Herkunftsfeld eines Wiki-Felds (`<feld>Origin`, WI-0225): der Art `art` im Katalog `FELD_HERKUNFT_FELDER` oder unter
 * `weitere` genannt?
 */
export function istHerkunftsfeld(
    art: EditorLockKind | undefined,
    feld: string,
    weitere: readonly string[] = [],
): boolean {
    if (!feld.endsWith("Origin")) return false;
    const wikiFeld = feld.slice(0, -"Origin".length);
    return (art !== undefined && FELD_HERKUNFT_FELDER[art].includes(wikiFeld)) || weitere.includes(wikiFeld);
}

/**
 * ↺ eines Wiki-Felds im Verlauf (WI-0225): Folgte der Wert vorher dem Wiki (`<feld>Origin.before` ist `wiki`), kommt er als
 * `{ revert: "wiki" }` zurück, sonst als der alte Wert. `undefined`: Der Gegenstand hat das Feld nicht geändert.
 */
export function wikiRuecknahme<T>(
    changes: MapHistoryObject["changes"],
    feld: string,
): WikiFeldAenderung<T> | undefined {
    const wechsel = changes[feld];
    if (wechsel === undefined) return undefined;
    return changes[`${feld}Origin`]?.before === "wiki" ? { revert: "wiki" } : { value: (wechsel.before ?? null) as T };
}

/** Ein Feld eines Eintrags zum Anzeigen: welches, alt und neu (roh). */
export interface VerlaufFeld {
    readonly feld: string;
    readonly vorher: unknown;
    readonly nachher: unknown;
}

/**
 * Was der Verlauf von der Bearbeitung des Objekts braucht: ihren gelesenen Stand, ihren Zustand (`gespeichert`: „Fertig“ hat geschrieben), ob eine Bearbeitung läuft und das Neulesen
 * nach ↺. Die Bearbeitung des Fensterrumpfs (`bearbeitung.ts`) erfüllt es; der Ort reicht eine Sicht (`ortseditor/ort-verlauf.ts`), weil auch ein Ort ohne Schreibrecht einen Verlauf hat.
 */
export interface VerlaufBearbeitung<D> {
    readonly detail: { readonly value: D | undefined };
    readonly zustand: { readonly value: { readonly art: string } };
    readonly lage: { readonly value: { readonly aktiv: boolean } };
    neuLesen(): Promise<void>;
}

export interface VerlaufOptionen<D> {
    readonly id: string;
    /** Die Bearbeitung des Objekts: ihr gelesener Stand, ob sie läuft, ob „Fertig“ geschrieben hat. */
    readonly bearbeitung: VerlaufBearbeitung<D>;
    /** ↺ ist geschrieben: die Karte neu (die Bearbeitung liest den neuen Stand selbst, `neuLesen`). */
    zurueckgenommen?(mapRevision: number | undefined): void;
    readonly fetcher?: typeof fetch;
    readonly neueKennung?: () => string;
}

export interface Verlauf<B> {
    readonly eintraege: Readonly<ShallowRef<readonly MapHistoryEntry[]>>;
    readonly laedt: Readonly<Ref<boolean>>;
    readonly fehler: Readonly<Ref<boolean>>;
    /** Gibt es ältere Einträge? */
    readonly mehrDa: ComputedRef<boolean>;
    /** Die Arbeitsserien der geladenen Seiten (WI-0265): mit allen ihren Mitgliedern, auch denen, die noch nicht geladen sind. */
    readonly serien: Readonly<ShallowRef<readonly MapHistorySeries[]>>;
    /** Warum ↺ gerade an keinem Eintrag geht: Eine Bearbeitung läuft (T44), oder ein ↺ wird geschrieben. */
    readonly gesperrt: ComputedRef<"bearbeitung" | "sendet" | undefined>;
    /** Der Satz des Servers, wenn ein ↺ abgelehnt wurde, an seinem Eintrag. */
    readonly meldung: Readonly<ShallowRef<{ readonly operationId: string; readonly satz: string } | undefined>>;
    felder(eintrag: MapHistoryEntry): VerlaufFeld[];
    /** Die Gegenstände einer Operation, die zum Objekt gehören (ohne Quellen), wie `felder` sie auswertet. */
    gegenstaende(eintrag: MapHistoryEntry): MapHistoryObject[];
    /** Revision vorher und nachher, wenn genau ein Gegenstand zum Objekt gehört. */
    revision(eintrag: MapHistoryEntry): { readonly vor: number | null; readonly nach: number } | undefined;
    /** Was ↺ täte; `undefined`, solange der Stand nicht gelesen ist. */
    ruecknahme(eintrag: MapHistoryEntry): Ruecknahme<B> | undefined;
    /** Die Adresse der Rücknahme durch den Server (B5c); `undefined`, wo das ↺ der Art gilt. */
    ruecknahmeZiel(eintrag: MapHistoryEntry): RuecknahmeZiel | undefined;
    /** Der Server hat zurückgenommen: die Karte, die Bearbeitung und der Verlauf ziehen nach. */
    nachRuecknahme(quittung: {
        readonly mapRevision?: number | undefined;
        readonly affected?: readonly { readonly kind: string; readonly id: string }[] | undefined;
    }): Promise<void>;
    zuruecknehmen(eintrag: MapHistoryEntry): Promise<void>;
    lade(mehr?: boolean): Promise<void>;
    destroy(): void;
}

export function createVerlauf<D, B>(art: VerlaufsArt<D, B>, optionen: VerlaufOptionen<D>): Verlauf<B> {
    const { id, bearbeitung } = optionen;
    const fetcher = optionen.fetcher ?? ((eingabe, init) => fetch(eingabe, init));
    const neueKennung = optionen.neueKennung ?? (() => crypto.randomUUID());
    const eintraege = shallowRef<readonly MapHistoryEntry[]>([]);
    const serien = shallowRef<readonly MapHistorySeries[]>([]);
    const laedt = ref(false);
    const fehler = ref(false);
    const sendet = ref(false);
    const meldung = shallowRef<{ operationId: string; satz: string } | undefined>(undefined);
    let weiter: number | undefined;
    const mehrDa = ref(false);
    let abbruch: AbortController | undefined;
    /** Erst gelesen, wenn die Anzeige ihn zeigt; danach hält er sich nach jedem Schreiben aktuell. */
    let gelesen = false;

    async function lade(mehr = false): Promise<void> {
        gelesen = true;
        abbruch?.abort();
        const eigene = new AbortController();
        abbruch = eigene;
        laedt.value = true;
        fehler.value = false;
        try {
            const vor = mehr && weiter !== undefined ? `?before=${String(weiter)}` : "";
            const antwort = await fetcher(`${art.url(id)}${vor}`, {
                signal: eigene.signal,
                cache: "no-store",
                headers: { accept: "application/json" },
            });
            if (!antwort.ok) throw new Error(`Verlauf ${id}: ${String(antwort.status)}`);
            const seite = (await antwort.json()) as MapHistoryPage;
            if (eigene.signal.aborted) return;
            eintraege.value = mehr ? [...eintraege.value, ...seite.entries] : seite.entries;
            serien.value = mehr ? [...serien.value, ...(seite.series ?? [])] : (seite.series ?? []);
            weiter = seite.next;
            mehrDa.value = seite.next !== undefined;
        } catch {
            if (!eigene.signal.aborted) fehler.value = true;
        } finally {
            if (abbruch === eigene) laedt.value = false;
        }
    }

    // Nach jedem „Fertig“ steht ein neuer Eintrag oben.
    const stopGespeichert = watch(
        () => bearbeitung.zustand.value,
        (zustand) => {
            if (zustand.art === "gespeichert" && gelesen) void lade();
        },
    );
    // Die Revision des Objekts ändert sich auch auf anderem Weg (Verschieben auf der Karte, Wiki-Sync): Dann steht ein neuer Eintrag oben. Dass die Bearbeitung den Stand erst
    // liest (vorher keine Revision), ist keine Änderung: Der Verlauf steht schon da, und ein zweites Lesen risse das erste mitten aus dem Laden.
    const stopRevision =
        art.revision === undefined
            ? undefined
            : watch(
                  () => {
                      const d = bearbeitung.detail.value;
                      return d === undefined ? undefined : art.revision?.(d);
                  },
                  (jetzt, vorher) => {
                      if (gelesen && vorher !== undefined && jetzt !== undefined) void lade();
                  },
              );

    const gehoerende = (eintrag: MapHistoryEntry): MapHistoryObject[] => {
        const d = bearbeitung.detail.value;
        return d === undefined ? [] : eintrag.objects.filter((gegenstand) => art.gehoert(gegenstand, d));
    };

    return {
        eintraege,
        laedt,
        fehler,
        mehrDa: computed(() => mehrDa.value),
        serien,
        gesperrt: computed(() => (sendet.value ? "sendet" : bearbeitung.lage.value.aktiv ? "bearbeitung" : undefined)),
        meldung,
        gegenstaende: (eintrag) => gehoerende(eintrag).filter((gegenstand) => !istQuellenGegenstand(gegenstand)),
        felder(eintrag) {
            const folge = art.feldFolge ?? [];
            const gesehen = new Set<string>();
            const raus: VerlaufFeld[] = [];
            for (const gegenstand of gehoerende(eintrag).filter((g) => !istQuellenGegenstand(g)))
                for (const [feld, wechsel] of Object.entries(gegenstand.changes)) {
                    if (
                        istHerkunftsfeld(art.herkunft, feld, art.herkunftsfelder) ||
                        istGrundFeld(feld) ||
                        art.ohneFelder?.includes(feld)
                    )
                        continue;
                    const schluessel = JSON.stringify([feld, wechsel.before ?? null, wechsel.after ?? null]);
                    if (gesehen.has(schluessel)) continue;
                    gesehen.add(schluessel);
                    raus.push({ feld, vorher: wechsel.before, nachher: wechsel.after });
                }
            const rang = (feld: string): number => {
                const i = folge.indexOf(feld);
                return i < 0 ? folge.length : i;
            };
            return raus.sort((a, b) => rang(a.feld) - rang(b.feld));
        },
        revision(eintrag) {
            const [einer, ...weitere] = gehoerende(eintrag);
            if (einer === undefined || weitere.length > 0 || einer.revisionAfter === null) return undefined;
            return { vor: einer.revisionBefore, nach: einer.revisionAfter };
        },
        ruecknahme(eintrag) {
            const d = bearbeitung.detail.value;
            if (istQuellenEintrag(eintrag)) return d === undefined ? undefined : { art: "nicht" };
            return d === undefined ? undefined : art.ruecknahme(eintrag, d, "vorschau");
        },
        ruecknahmeZiel: (eintrag) => art.ruecknahmeZiel?.(eintrag, id),
        async nachRuecknahme(quittung) {
            art.nachRuecknahme?.(quittung);
            optionen.zurueckgenommen?.(quittung.mapRevision);
            await Promise.all([bearbeitung.neuLesen(), lade()]);
        },
        async zuruecknehmen(eintrag) {
            const d = bearbeitung.detail.value;
            if (d === undefined || sendet.value || bearbeitung.lage.value.aktiv || istQuellenEintrag(eintrag)) return;
            const plan = art.ruecknahme(eintrag, d, neueKennung());
            if (plan.art !== "geht") return;
            sendet.value = true;
            meldung.value = undefined;
            const antwort = await art.schreibe(id, plan.body);
            sendet.value = false;
            if (!antwort.ok) {
                meldung.value = { operationId: eintrag.operationId, satz: antwort.fehler.message };
                return;
            }
            optionen.zurueckgenommen?.(antwort.quittung.mapRevision);
            await Promise.all([bearbeitung.neuLesen(), lade()]);
        },
        lade,
        destroy() {
            abbruch?.abort();
            stopGespeichert();
            stopRevision?.();
        },
    };
}
