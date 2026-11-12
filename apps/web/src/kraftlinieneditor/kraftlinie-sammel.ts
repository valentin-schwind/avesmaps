import { shallowRef, type ShallowRef } from "vue";
import {
    EDITOR_POWERLINES_SAMMEL_STAND_URL,
    EDITOR_POWERLINES_SAMMEL_WIKI_URL,
    EDITOR_POWERLINES_URL,
    type EditorPowerlineDetail,
    type EditorPowerlineRow,
    type OperationReceipt,
    type PowerlineSammelLinie,
    type PowerlineSammelStandBody,
    type PowerlineSammelWikiBody,
} from "@avesmaps3d/shared";
import { getJson, newOperationId, type Fetcher } from "../auth/api";
import { sende, type SchreibAntwort } from "../fenster/entwurf-senden";
import { createSammelEntwurf, type SammelArt, type SammelEntwurf } from "../fenster/sammel";
import { t } from "../i18n/i18n";
import { nacheinander } from "../ortseditor/ort-sammel";
import { felderAus } from "./kraftlinie-art";
import { KRAFTLINIE_WIKI_FELDER, kraftlinieWikiLage, type KraftlinieWikiFeld } from "./kraftlinie-wiki-felder";

/**
 * Die Mehrfachauswahl der Kraftlinien (WI-0238; EDIT-0003 T57 nach Fassung 5 der Gebiete, für Kraftlinien „zunächst nur ‚Entfernen …‘ und
 * ↺“). Die Häkchen stehen in der Liste (`EditorListe v-model:mehrfach v-model:angehakt`); ab zwei angehakten zeigt das Fenster statt der
 * Eigenschaften einer Linie diese Auswahl (`kraftlinie-sammel.vue`).
 *
 * - **Gemeinsam:** ↺ „auf Wiki-Werte“ an Name und Beschreibung (`createSammelEntwurf`: ein Schritt je Feld, „Fertig“ der Leiste schreibt
 *   alles als EINE Operation, `powerline.update_line` über alle Linien) und „Entfernen …“ in zwei Stufen (sofort nach der Bestätigung, EINE
 *   Operation `powerline.take_off_map` oder `powerline.retire`; ↺ im Verlauf einer der Linien nimmt alle zusammen zurück,
 *   `kraftlinie-verlauf.ts`).
 * - **Nur einzeln:** Name, Beschriftung und Beschreibung als Werte, die Nodices und die Kurve, die Wiki-Zuordnung. Der Reiter „Verlauf“
 *   steht grau.
 * - ↺ gilt für alle, die am Feld einen eigenen Wert haben (`eigeneJeFeld`, wie am Ort); eine Linie ohne Artikel behält ihren (der
 *   Server lässt sie aus). Ohne eine einzige mit eigenem Wert ist ↺ gesperrt.
 * - Geschrieben wird gegen die Abschnitte und Revisionen, die die Auswahl zuletzt gelesen hat (`details`): Ein Konflikt (409) lässt den
 *   Entwurf stehen.
 * - Die Auswahl ist flüchtig: Ein Wechsel der Häkchen beginnt eine neue (`createKraftlinieSammel` je Satz von Kennungen), sie hält keine
 *   Sperre und sichert nicht im Browser.
 */

/** Gemeinsame Felder mit Wert hat die Kraftlinie in T57 nicht; gemeinsam sind nur ↺ und „Entfernen …“. */
export type KraftlinieSammelFelder = Record<string, never>;

/** Was nur einzeln geht (steht mit „Nur einzeln“ da). */
export const KRAFTLINIE_NUR_EINZELN = ["name", "beschriftung", "beschreibung", "nodices", "wiki"] as const;

export type SammelEntfernen = "abnehmen" | "loeschen";

export interface KraftlinieSammel {
    readonly ids: readonly string[];
    /** Die gelesenen Linien (Abschnitte mit Revisionen); bis alle da sind, ist Schreiben gesperrt. */
    readonly details: Readonly<ShallowRef<ReadonlyMap<string, EditorPowerlineDetail>>>;
    readonly ladeFehler: Readonly<ShallowRef<boolean>>;
    readonly entwurf: SammelEntwurf<KraftlinieSammelFelder>;
    /** Die Zeilen der Liste, soweit gewählt (für Namen, Artikel und Stand). */
    zeilen(): readonly EditorPowerlineRow[];
    /**
     * Liest die Linien neu (Abschnitte und Revisionen), ohne dass die Auswahl selbst schrieb (WI-0265 B6h2: eine Rücknahme über den Server hat Linien berührt, `kraftlinie-melde.ts`).
     * Der Entwurf bleibt; „Fertig“ schreibt danach gegen den neuen Stand, nicht gegen einen, den es nicht mehr gibt (409).
     */
    neuLesen(): Promise<void>;
    /** „Entfernen …“ für alle: `undefined` geschrieben, sonst der Satz, warum nicht. */
    entferne(wahl: SammelEntfernen): Promise<string | undefined>;
    destroy(): void;
}

export interface KraftlinieSammelOptionen {
    readonly fetcher: Fetcher;
    /** Die Liste, wie sie gerade steht. */
    zeilen(): readonly EditorPowerlineRow[];
    /** Geschrieben (↺ oder Entfernen): Kachelrevision, Liste und offene Linien neu lesen. */
    geschrieben(quittung: OperationReceipt): void;
}

/** Wie viele der gelesenen Linien an einem Wiki-Feld einen eigenen Wert haben, den ↺ zurücksetzen würde. */
export function eigeneJeFeld(details: Iterable<EditorPowerlineDetail>): Record<KraftlinieWikiFeld, number> {
    const zahl: Record<KraftlinieWikiFeld, number> = { name: 0, description: 0 };
    for (const linie of details) {
        const felder = felderAus(linie);
        for (const feld of KRAFTLINIE_WIKI_FELDER) if (kraftlinieWikiLage(felder, feld).zurueck) zahl[feld] += 1;
    }
    return zahl;
}

/** Je Linie ihr Anker und ihre Abschnitte, wie die Auswahl sie gelesen hat. */
export function linienAus(
    details: ReadonlyMap<string, EditorPowerlineDetail>,
    ids: readonly string[],
): PowerlineSammelLinie[] {
    return ids.flatMap((id) => {
        const d = details.get(id);
        return d === undefined
            ? []
            : [{ anker: d.id, segments: d.segments.map((a) => ({ id: a.id, baseRevision: a.revision })) }];
    });
}

/** Der Satz zu einer Ablehnung des Servers, wie bei einer einzelnen Linie. */
function satzVon(antwort: Extract<SchreibAntwort, { ok: false }>): string {
    if (antwort.status === 409) return t("kraftlinieneditor.sammel.konflikt");
    return antwort.fehler.message;
}

export function createKraftlinieSammel(ids: readonly string[], optionen: KraftlinieSammelOptionen): KraftlinieSammel {
    const details = shallowRef<ReadonlyMap<string, EditorPowerlineDetail>>(new Map());
    const ladeFehler = shallowRef(false);
    const steuer = new AbortController();
    /** Das Lesen, dessen Antwort gilt: Ein späteres (nach einem Schreiben, einem Konflikt oder einer Rücknahme) löst ein früheres ab. */
    let lauf = 0;
    // Immer frisch (Revisionen) und abbrechbar, wenn die Auswahl wechselt.
    const holen: Fetcher = (url, init) => optionen.fetcher(url, { ...init, cache: "no-store", signal: steuer.signal });

    async function lade(): Promise<void> {
        const meiner = (lauf += 1);
        try {
            // Höchstens sechs zugleich, wie am Ort (`nacheinander`): Eine Auswahl kann 200 Linien tragen.
            const gelesen = await nacheinander(ids, (id) =>
                getJson<EditorPowerlineDetail>(`${EDITOR_POWERLINES_URL}/${id}`, holen),
            );
            if (steuer.signal.aborted || meiner !== lauf) return;
            details.value = new Map(ids.map((id, i) => [id, gelesen[i]!] as const));
            ladeFehler.value = false;
        } catch {
            if (!steuer.signal.aborted && meiner === lauf) ladeFehler.value = true;
        }
    }

    const art: Pick<SammelArt<EditorPowerlineDetail, KraftlinieSammelFelder>, "schreibe"> = {
        schreibe: async (gewaehlt, aenderungen, operationId) => {
            const felder = aenderungen.wiki.filter(
                (feld): feld is "name" | "description" => feld === "name" || feld === "description",
            );
            const body: PowerlineSammelWikiBody = { operationId, felder, lines: linienAus(details.value, gewaehlt) };
            const antwort = await sende(EDITOR_POWERLINES_SAMMEL_WIKI_URL, body, "POST", optionen.fetcher);
            // Konflikt: neu lesen; der Entwurf bleibt, „Fertig“ schreibt dann gegen den neuen Stand.
            if (!antwort.ok && antwort.status === 409) void lade();
            return antwort;
        },
    };
    const entwurf = createSammelEntwurf<KraftlinieSammelFelder>(art, ids, {
        geschrieben: (quittung) => {
            optionen.geschrieben(quittung);
            void lade();
        },
    });

    const zeilen = (): readonly EditorPowerlineRow[] => optionen.zeilen().filter((zeile) => ids.includes(zeile.id));

    void lade();

    return {
        ids,
        details,
        ladeFehler,
        entwurf,
        zeilen,
        neuLesen: lade,
        async entferne(wahl) {
            const lines = linienAus(details.value, ids);
            if (lines.length !== ids.length) return t("kraftlinieneditor.sammel.laedt");
            const body: PowerlineSammelStandBody = {
                operationId: newOperationId(),
                wechsel: wahl === "abnehmen" ? "powerline.take_off_map" : "powerline.retire",
                lines,
            };
            const antwort = await sende(EDITOR_POWERLINES_SAMMEL_STAND_URL, body, "POST", optionen.fetcher);
            if (!antwort.ok) {
                // Ein Konflikt heißt: Eine Linie hat sich inzwischen geändert. Neu lesen, dann geht es mit dem neuen Stand.
                if (antwort.status === 409) void lade();
                return satzVon(antwort);
            }
            optionen.geschrieben(antwort.quittung);
            return undefined;
        },
        destroy() {
            steuer.abort();
        },
    };
}
