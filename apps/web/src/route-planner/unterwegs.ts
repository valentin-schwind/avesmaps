import { computed, onScopeDispose, shallowRef, watch, type ComputedRef } from "vue";
import {
    LORE_ROWS,
    ROUTE_UNTERWEGS_GEGENDEN_URL,
    ROUTE_UNTERWEGS_URL,
    type LoreKind,
    type RouteResponse,
    type RouteUnterwegsEintrag,
    type RouteUnterwegsGegendenRequest,
    type RouteUnterwegsGegendenResponse,
    type RouteUnterwegsRequest,
    type RouteUnterwegsResponse,
} from "@avesmaps3d/shared";
import { formatNumber } from "./planner-model";
import { t, tPlural } from "../i18n/i18n";
import { holeBeigabe } from "./load-retry";
import { frageBeigaben } from "./route-landscapes";
import { unterwegsAnfrage } from "./stage-lore";

export { unterwegsAnfrage };

/**
 * „Vorkommen unterwegs“ (WI-0257 S4, Betreiber 2026-10-29): Alles, was auf der Reise vorkommt - Waren, Fauna, Flora, Spezies -, einmal, mit der ersten Etappe und der Gegend, in der es zuerst
 * vorkommt. Eine Klappbox der Routendetails (`unterwegs-box.vue`); die gewählten Einträge färben die Etappen, in denen sie vorkommen, und leuchten auf der Karte (`unterwegs-auswahl.ts`, S5).
 *
 * 🔴 **Eine Frage je Route, nie je Etappe** (`POST /api/route/unterwegs`): Der Server rechnet jede Etappe mit DERSELBEN Stelle wie das Infopanel der Etappe und vereinigt. Was im Panel der Etappe 3 steht,
 * steht hier „ab Etappe 3“ oder früher; eine zweite Wahrheit gibt es nicht. Der Browser sammelt nichts selbst: Er schickt die Wege und Linien der Etappen (dieselben wie bei `stage/lore`,
 * `stagePathIds` und `stageLines`) und liest die Antwort.
 *
 * 🔴 **Eine Beigabe wie die Landschaften der Route** (`route-landscapes.ts`): Scheitert die Frage, fehlt die Box, und die Route bleibt, wie sie ist. Eine Absage wegen Last (503 `busy`) wird wie dort
 * still wiederholt, die Drossel (429) einmal (`holeBeigabe`). Die Antwort gehört der Route, für die gefragt wurde; eine andere Route zeigt sie nie.
 *
 * 🔴 **Sie fährt mit der Frage nach den Landschaften** (WI-0292, Vali 2026-11-09: „ein paar schnelle Änderungen“ leerten die Drossel der Reise): `frageBeigaben` legt den Körper in
 * DIESELBE Frage (`POST /api/route/landscapes` mit `unterwegs`); einzeln gefragt wird nur, wo die Antwort ihn nicht mitbringt.
 */

/** Holt die Vorkommen der Route einzeln; `null`, wenn es nicht gelingt. Eine Absage wegen Last fragt wie die Route selbst noch einmal, die Drossel einmal (`holeBeigabe`), ohne Meldung. */
export async function fetchUnterwegs(
    request: RouteUnterwegsRequest,
    signal?: AbortSignal,
    fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
): Promise<RouteUnterwegsResponse | null> {
    const init: RequestInit = {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        ...(signal ? { signal } : {}),
    };
    return (await holeBeigabe<RouteUnterwegsResponse>(ROUTE_UNTERWEGS_URL, init, fetcher)).antwort;
}

/**
 * Die Gegenden EINES gewählten Eintrags, die die Route kreuzt (`POST /api/route/unterwegs/gegenden`, WI-0257 S5, Vali 2026-10-31); `null`, wenn es nicht gelingt. Wie die Liste:
 * eine Absage wegen Last fragt still noch einmal.
 */
export async function fetchUnterwegsGegenden(
    request: RouteUnterwegsGegendenRequest,
    signal?: AbortSignal,
    fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
): Promise<RouteUnterwegsGegendenResponse | null> {
    const init: RequestInit = {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        ...(signal ? { signal } : {}),
    };
    return (await holeBeigabe<RouteUnterwegsGegendenResponse>(ROUTE_UNTERWEGS_GEGENDEN_URL, init, fetcher)).antwort;
}

/**
 * Die Einträge zur jeweils gezeigten Route. Eine neue Route bricht die Frage nach der alten ab, samt ihrer Pausen, ebenso der Abbau; solange die Antwort fehlt oder zu einer anderen Route gehört,
 * ist die Liste `null` (keine Box).
 */
export function useUnterwegs(
    route: () => RouteResponse | null,
    fetcher?: typeof fetch,
): { liste: ComputedRef<readonly RouteUnterwegsEintrag[] | null> } {
    const data = shallowRef<{ route: RouteResponse; eintraege: readonly RouteUnterwegsEintrag[] } | null>(null);
    let controller: AbortController | undefined;
    watch(
        route,
        async (current) => {
            controller?.abort();
            const request = current === null ? null : unterwegsAnfrage(current);
            if (current === null || request === null) {
                data.value = null;
                return;
            }
            const own = new AbortController();
            controller = own;
            // Erst die gemeinsame Frage mit den Landschaften (WI-0292); bringt sie nichts mit (`undefined`), fragt die Box selbst. `null` heißt: an der Drossel gescheitert, kein zweiter Anlauf.
            const mitgefahren = (await frageBeigaben(current, own.signal, { unterwegs: request }, fetcher)).unterwegs;
            if (controller !== own) return;
            const answer = mitgefahren === undefined ? await fetchUnterwegs(request, own.signal, fetcher) : mitgefahren;
            if (controller === own) data.value = answer ? { route: current, eintraege: answer.eintraege } : null;
        },
        { immediate: true },
    );
    onScopeDispose(() => controller?.abort());
    return {
        liste: computed(() => {
            const shown = data.value;
            return shown && shown.route === route() ? shown.eintraege : null;
        }),
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// Das Modell der Liste
// ---------------------------------------------------------------------------------------------------------------------

/** Eine Zeile der Liste: der Eintrag, seine erste Etappe (ab 1, wie die Etappenliste sie nummeriert) und die Gegend (leer, wo es keine gibt). */
export interface UnterwegsZeile {
    id: string;
    name: string;
    kind: LoreKind;
    /** Die Etappen, in deren Panel der Eintrag steht, ab 0 (die Nummer der Etappenliste ist `index + 1`). */
    etappen: readonly number[];
    /** Die erste Etappe, ab 1. */
    ab: number;
    gegend: string;
}

/** Die Zeilen einer Art. */
export interface UnterwegsGruppe {
    kind: LoreKind;
    zeilen: readonly UnterwegsZeile[];
}

/**
 * Die Gruppen in der Reihenfolge der Infobox (Waren, Fauna, Flora, Spezies); eine Art ohne Eintrag hat keine Gruppe. Innerhalb der Gruppe nach Name (ohne Beachtung der Groß- und Kleinschreibung):
 * Wer einen bestimmten Eintrag sucht, findet ihn so, und die erste Etappe steht dahinter.
 */
const COLLATOR = new Intl.Collator("de");
export function unterwegsGruppen(eintraege: readonly RouteUnterwegsEintrag[]): UnterwegsGruppe[] {
    return LORE_ROWS.flatMap((kind) => {
        const zeilen = eintraege
            .filter((eintrag) => eintrag.kind === kind)
            .map((eintrag): UnterwegsZeile => ({
                id: eintrag.id,
                name: eintrag.name,
                kind,
                etappen: eintrag.etappen,
                ab: (eintrag.etappen[0] ?? 0) + 1,
                gegend: eintrag.gegend ?? "",
            }))
            .sort((links, rechts) => COLLATOR.compare(links.name, rechts.name));
        return zeilen.length === 0 ? [] : [{ kind, zeilen }];
    });
}

/** Die Wörter der Infobox zu einer Zahl, ohne die Zahl: „Handelswaren“, „Tierart“, „Pflanzenarten“, „Spezies“ - dieselben Tafelschlüssel wie die Kurzsätze des Infopanels (`infoPanel.lore.<art>.short`), Einzahl und Mehrzahl über `tPlural`. */
function artWort(kind: LoreKind, n: number): string {
    return tPlural(`infoPanel.lore.${kind}.short`, n, { n: "" }).trim();
}

/** Eine Zahl im Deckel: die Art (für das Zeichen) und die Zahl, wie die Seite sie schreibt. */
export interface UnterwegsZahl {
    kind: LoreKind;
    zahl: string;
}

/**
 * Die Zahlen im Deckel (WI-0257 S4, Antwort des Betreibers: „Zeichen statt Wörter“): je Art das Kategoriezeichen mit der Zahl (Korb 23, Pfote 68, Blume 44, Person 9). Eine Art ohne Eintrag hat
 * keine Gruppe und damit keine Zahl; die Reihenfolge ist die der Infobox.
 */
export function unterwegsZahlen(gruppen: readonly UnterwegsGruppe[]): UnterwegsZahl[] {
    return gruppen.map((gruppe) => ({ kind: gruppe.kind, zahl: formatNumber(gruppe.zeilen.length, 0) }));
}

/**
 * Die Wörter zum Deckel, für den Screenreader und als `title` („23 Handelswaren, 68 Tierarten, 44 Pflanzenarten, 9 Spezies“, Betreiber 2026-10-29: „68 Fauna · 100 Flora klingt komisch“):
 * in den Worten der Infobox, Einzahl und Mehrzahl richtig.
 */
export function unterwegsDeckel(gruppen: readonly UnterwegsGruppe[]): string {
    return gruppen
        .map((gruppe) => `${formatNumber(gruppe.zeilen.length, 0)} ${artWort(gruppe.kind, gruppe.zeilen.length)}`)
        .join(", ");
}

/** Etappennummern als Text: „2 bis 4, 6“ (aufeinanderfolgende Etappen zu einem Bereich); die Eingabe zählt ab 0, die Ausgabe ab 1. */
export function etappenText(etappen: readonly number[]): string {
    const sorted = [...new Set(etappen)].sort((a, b) => a - b);
    const parts: string[] = [];
    for (let at = 0; at < sorted.length;) {
        let end = at;
        while (end + 1 < sorted.length && (sorted[end + 1] as number) === (sorted[end] as number) + 1) end += 1;
        const first = (sorted[at] as number) + 1;
        const last = (sorted[end] as number) + 1;
        parts.push(
            last - first >= 2
                ? t("planner.unterwegs.bis", { from: String(first), to: String(last) })
                : last === first
                  ? String(first)
                  : `${String(first)}, ${String(last)}`,
        );
        at = end + 1;
    }
    return parts.join(", ");
}
