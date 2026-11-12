import { computed, onScopeDispose, shallowRef, watch, type ComputedRef } from "vue";
import {
    subjectKey,
    type RouteLandscapesResponse,
    type RouteLandscapeStage,
    type MapBounds,
    type RouteResponse,
    type RouteUnterwegsRequest,
    type RouteUnterwegsResponse,
    type SubjectSprache,
} from "@avesmaps3d/shared";
import { formatNumber, isMessageKey, t, tPlural, type PluralCase } from "../i18n/i18n";
import { wegfindungImBrowserWerte } from "../map/start-view";
import { holeBeigabe, type Beigabe } from "./load-retry";

/**
 * „Landschaften auf der Route“ und „durch …“ je Etappe (WI-0035, Legacy V10 „Führt durch“).
 *
 * Legacys Regeln (`map-features-path-landscapes.js`, Owner 2026-07-29), hier im Browser, weil die Art
 * in der Sprache der Seite heißt:
 * - **Name, sonst Art.** Wo die Region nur einen Griff trägt („Wald-925“), steht ihre Art („Wald“).
 *   Ohne beides entfällt der Eintrag.
 * - **Gleiche Namen sind EIN Eintrag**: zwei namenlose Seen einer Etappe sind „See“, nicht „See, See“.
 *   Die Längen addieren sich, der Anteil endet bei 100 %.
 * - **Unter 5 % entfällt ein Name**, sortiert wird nach Anteil. Prozente zeigt der Planer nicht
 *   („beim routenplaner muss kein % dranstehn“).
 * - **Jede Etappe nennt ihre eigenen Landschaften vollständig.** „Nur was neu ist“ hat der Owner am
 *   fertigen Bild widerrufen: Eine leere Zeile unter einer benannten liest sich wie „nichts bekannt“.
 *
 * 🔴 Die Route bleibt, wie sie ist, wenn diese Zeile scheitert: Sie ist eine Beigabe, und ein Fehler
 * im Netz nimmt dem Planer nichts weg (Legacy ebenso).
 */

export interface LandscapeEntry {
    /**
     * Die Region, die den Eintrag trägt - bei zusammengefassten Namen die erste, oder die, deren Beschriftung
     * das Ziel stellt. Ein Klick lässt genau diese Fläche leuchten (WI-0043).
     */
    key: string;
    name: string;
    /** Die Art, als Hinweis beim Überfahren; leer, wo sie schon der Name ist. */
    art: string;
    /** Die Art dieser Region als Schlüssel (`region_type`), ungedeutet: Sie setzt den Namen der Auswahl in Versalien. */
    type: string;
    share: number;
    /** Wohin ein Klick fliegt: die Beschriftung, wie ein Landschaftstreffer der Suche. */
    target: { label?: string; x: number; y: number; zoom: number; bounds?: MapBounds } | null;
}

export type TerritoryEntry = NonNullable<RouteLandscapesResponse["territories"]>[number][number];

export interface LandscapeLines {
    route: LandscapeEntry[];
    stages: LandscapeEntry[][];
    territories?: RouteLandscapesResponse["territories"];
    /** Je Etappe ihre Sprachen (WI-0261); fehlt, wo keine Etappe eine berührt. */
    sprachen?: RouteLandscapesResponse["sprachen"];
    /** Die Sprachen der ganzen Route mit ihrem Anteil an der Strecke (`routeSprachen`); fehlt, wo keine Etappe eine berührt. */
    routeSprachen?: SubjectSprache[];
}

const COLLATOR = new Intl.Collator("de");

/** Die Art in der Sprache der Seite; eine unbekannte Art hat keinen Namen. */
export function landscapeTypeLabel(type: string): string {
    const key = `landscape.type.${type}`;
    return type !== "" && isMessageKey(key) ? t(key) : "";
}

/** Die Art eines Kandidaten der Kartenauswahl: bei Flächen ihre Landschaftsart, bei Flüssen „Fluss“ oder „Bach“, bei Gebieten ihre Art. */
export function candidateTypeLabel(candidate: {
    kind: "landscape" | "path" | "territory";
    type: string;
    bach?: boolean;
    layer?: string | undefined;
}): string {
    if (candidate.kind === "path") return t(candidate.bach === true ? "areaChoice.brook" : "areaChoice.river");
    // Ein Herrschaftsgebiet nennt seine Art, wie Legacy sie führt („Baronie“, „Grafschaft“); leer heißt „Herrschaftsgebiet“.
    if (candidate.kind === "territory") return candidate.type === "" ? t("areaChoice.territory") : candidate.type;
    // Eine Region ohne Art (Svelltland, Gjalskerland) heißt „Region“ wie ein Urwald „Urwald“ (Betreiber 2026-10-20).
    const art = landscapeTypeLabel(candidate.type);
    return art === "" && candidate.layer === "derographisch" ? t("areaChoice.region") : art;
}

/** Die Linien je Etappe, wie die Route sie fährt - ungeglättet, denn gemessen wird an ihnen. */
export function stageLines(route: RouteResponse): [number, number][][][] {
    return route.stages.map((stage) =>
        route.segments
            .slice(stage.segment_start, stage.segment_start + stage.segment_count)
            .map((segment) => segment.geometry.coordinates.map(([x, y]) => [x, y] as [number, number]))
            .filter((line) => line.length >= 2),
    );
}

/** Die Zeile über einige Etappen: eine Etappe, oder alle für die Route. */
export function landscapeLine(
    stages: readonly RouteLandscapeStage[],
    regions: RouteLandscapesResponse["regions"],
    typeLabel: (type: string) => string = landscapeTypeLabel,
    order: "share" | "encounter" = "share",
): LandscapeEntry[] {
    let total = 0;
    const covered = new Map<string, LandscapeEntry & { length: number }>();
    for (const stage of stages) {
        total += stage.length;
        for (const [key, length] of stage.in) {
            const region = regions[key];
            if (!region) continue;
            const art = typeLabel(region.type);
            const name = region.name ?? art;
            if (name === "") continue;
            const entry = covered.get(name);
            if (entry) {
                entry.length += length;
                // Ein Ziel reicht: Hat die erste gleichnamige Region keine Beschriftung, nimmt der Eintrag eine andere -
                // und mit ihr deren Kennung. Sonst leuchtete eine Fläche, und der Klick flöge zu einer anderen (WI-0043).
                if (!entry.target && region.target) {
                    entry.target = region.target;
                    entry.key = key;
                    entry.type = region.type;
                }
            } else {
                covered.set(name, {
                    key,
                    name,
                    art: art === name ? "" : art,
                    type: region.type,
                    share: 0,
                    target: region.target,
                    length,
                });
            }
        }
    }
    if (!(total > 0)) return [];
    // Der eingestellte Anteil (WI-0214); das Register führt ihn in Prozent, hier rechnet ein Anteil.
    const minShare = wegfindungImBrowserWerte().landscapeMinShare / 100;
    const entries = [...covered.values()]
        .map(({ length, ...entry }) => ({ ...entry, share: Math.min(1, length / total) }))
        .filter((entry) => entry.share >= minShare);
    return order === "encounter"
        ? entries
        : entries.sort((left, right) => right.share - left.share || COLLATOR.compare(left.name, right.name));
}

/**
 * Die Sprachen der ganzen Route (WI-0261 O8; Bauvorlage: Probierseite „Sprachen unterwegs“ Fassung 2, Betreiber 2026-11-01 „Ja, bauen“): je Sprache
 * die Länge der Etappen in ihrer Fläche (Anteil der Etappe mal ihre Länge), geteilt durch die ganze Strecke, die größte zuerst. Es zählt, was eine
 * Etappe nennt - der Server hat dort schon den Mindestanteil der Karteneinstellungen angewandt; eine Sprache, die auf einer langen Route nur eine
 * kurze Etappe trägt, steht deshalb mit wenigen Prozent da. Der Rest der Strecke (See, keine Sprachfläche) steht in keiner Zeile.
 */
export function routeSprachen(
    stages: readonly RouteLandscapeStage[],
    sprachen: RouteLandscapesResponse["sprachen"],
): SubjectSprache[] {
    if (sprachen === undefined) return [];
    let total = 0;
    const je = new Map<string, { sprache: SubjectSprache; laenge: number }>();
    stages.forEach((stage, index) => {
        total += stage.length;
        for (const sprache of sprachen[index] ?? []) {
            const key = subjectKey(sprache.ref);
            const eintrag = je.get(key) ?? { sprache, laenge: 0 };
            eintrag.laenge += sprache.anteil * stage.length;
            je.set(key, eintrag);
        }
    });
    if (!(total > 0)) return [];
    return [...je.values()]
        .map(({ sprache, laenge }) => ({ ...sprache, anteil: Math.min(1, laenge / total) }))
        .sort((left, right) => right.anteil - left.anteil || COLLATOR.compare(left.name, right.name));
}

/**
 * Der Deckel der gemeinsamen Klappbox (WI-0081): die Zahl der Gegenden, der Sprachen und der politischen Gebiete. 🔴 Er beginnt mit der Zahl,
 * ohne „Durch“ (Betreiber 2026-10-05). Fehlt eine Liste, nennt er nur die vorhandenen; ohne alle gibt es keine Box.
 *
 * 🔴 **Mit Sprachen bleibt er einzeilig** (WI-0261 O8, Betreiber 2026-11-01: „pass auf dass die klappbox nicht mehr wie eine zeile bekommt“): Dann heißen
 * die Gebiete kurz „81 Gebiete“ - die Überschrift innen sagt „Politische Gebiete“. Gemessen an der Probierseite: Auch „143 Gegenden, 11 Sprachen und
 * 288 Gebiete“ passt in den Kopf des 350 px breiten Planers; „17 Gegenden, 4 Sprachen und 81 politische Gebiete“ passte nicht. Ohne Sprachen bleibt
 * der Deckel, wie er war.
 *
 * 🪤 Der Satz wird NICHT aus Halbsätzen zusammengesetzt: Die Sprachtafel trägt je Fall den ganzen Rahmen (`planner.summary.areas…`) und setzt die
 * Zählangaben ein. So stimmt die Einzahl in jeder Verbindung („1 Gegend und 43 politische Gebiete“), und keine Sprache erbt die Satzstellung einer anderen.
 */
export function areasLid(landscapes: number, sprachen: number, territories: number): string {
    const zahl = (n: number, fall: PluralCase): string => tPlural(fall, n, { n: formatNumber(n, 0) });
    const l = zahl(landscapes, "planner.summary.landscapes");
    if (sprachen > 0) {
        const s = zahl(sprachen, "planner.summary.sprachen");
        const g = zahl(territories, "planner.summary.gebiete");
        if (landscapes > 0 && territories > 0)
            return t("planner.summary.areas.mitSprachen", { landscapes: l, sprachen: s, territories: g });
        if (landscapes > 0) return t("planner.summary.areas.mitSprachen.landscapes", { landscapes: l, sprachen: s });
        if (territories > 0) return t("planner.summary.areas.mitSprachen.territories", { sprachen: s, territories: g });
        return t("planner.summary.areas.sprachen", { sprachen: s });
    }
    const g = zahl(territories, "planner.summary.territories");
    if (landscapes > 0 && territories > 0) return t("planner.summary.areas", { landscapes: l, territories: g });
    if (landscapes > 0) return t("planner.summary.areas.landscapes", { landscapes: l });
    return t("planner.summary.areas.territories", { territories: g });
}

/**
 * Fragt die Landschaften zu einer Route, mit `unterwegs` auch die Vorkommen unterwegs in DERSELBEN Frage (WI-0292). Eine Absage wegen Last (503 `busy`, der Server rechnet je
 * Prozess höchstens zwei Abfragen zugleich) fragt wie die Route selbst noch einmal, die Drossel (429) einmal (`holeBeigabe`), ohne Meldung: Die Zeile kommt dann später oder gar nicht.
 */
function frageLandschaften(
    route: RouteResponse,
    signal: AbortSignal | undefined,
    unterwegs: RouteUnterwegsRequest | undefined,
    fetcher?: typeof fetch,
): Promise<Beigabe<RouteLandscapesResponse>> {
    const request: RequestInit = {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
            unterwegs === undefined ? { stages: stageLines(route) } : { stages: stageLines(route), unterwegs },
        ),
        ...(signal ? { signal } : {}),
    };
    return holeBeigabe<RouteLandscapesResponse>("/api/route/landscapes", request, fetcher);
}

/** Holt die Landschaften zu einer Route; `null`, wenn es nicht gelingt (`frageLandschaften`). */
export async function fetchRouteLandscapes(
    route: RouteResponse,
    signal?: AbortSignal,
): Promise<RouteLandscapesResponse | null> {
    return (await frageLandschaften(route, signal, undefined)).antwort;
}

/**
 * Was die gemeinsame Frage einer Route bringt (WI-0292). `undefined` heißt: nicht mitgefragt oder nicht mitgebracht, der Leser fragt selbst; `null` heißt: gescheitert, beim
 * Unterwegs nur an der Drossel (dann fragt niemand gleich noch einmal).
 */
export interface Beigaben {
    landschaften: RouteLandscapesResponse | null | undefined;
    unterwegs: RouteUnterwegsResponse | null | undefined;
}

interface Sammlung {
    landschaften: boolean;
    unterwegs: RouteUnterwegsRequest | undefined;
    gesendet: boolean;
    fertig: boolean;
    leser: number;
    controller: AbortController;
    antwort: Promise<Beigaben>;
}

/** Die offenen und beantworteten Fragen je Route (das Objekt der Planerantwort): Kommt dieselbe Route wieder (Zwischenspeicher des Planers), fragt niemand neu. */
const sammlungen = new WeakMap<RouteResponse, Sammlung>();

/**
 * 🔴 **EINE Frage je Route für Landschaften und Unterwegs** (WI-0292, Vali 2026-11-09: der Planer lief in Production schnell in die Drossel der Reise, 429). Die Landschaften liest
 * `app.vue` (`useRouteLandscapes`), das Unterwegs die Routendetails (`useUnterwegs`); beide fragten einzeln, jede neue Route kostete so drei Fragen in derselben Zone.
 *
 * - **Wer im selben Zug fragt, fährt mit.** Beide beobachten dieselbe Route und melden sich im selben Durchlauf von Vue; gesendet wird erst im nächsten Mikrotakt, dann mit allem,
 *   was angemeldet ist. Fragt nur das Unterwegs (ohne Landschaften), wird nichts gesendet, und es fragt selbst wie vorher.
 * - **Abbruch erst, wenn niemand mehr wartet.** Jeder Leser hat sein Signal; die Frage bricht ab, wenn das letzte abbricht.
 * - **Gemerkt wird die Antwort am Routenobjekt**, nur eine gelungene: Kommt die Route aus dem Zwischenspeicher des Planers zurück, kommen die Beigaben ohne Frage mit.
 */
export function frageBeigaben(
    route: RouteResponse,
    signal: AbortSignal,
    teil: { landschaften?: true; unterwegs?: RouteUnterwegsRequest },
    fetcher?: typeof fetch,
): Promise<Beigaben> {
    let sammlung = sammlungen.get(route);
    if (sammlung === undefined) {
        let senden = (): void => undefined;
        const bereit = new Promise<void>((resolve) => {
            senden = resolve;
        });
        const neu: Sammlung = {
            landschaften: false,
            unterwegs: undefined,
            gesendet: false,
            fertig: false,
            leser: 0,
            controller: new AbortController(),
            antwort: Promise.resolve({ landschaften: undefined, unterwegs: undefined }),
        };
        neu.antwort = bereit.then(async (): Promise<Beigaben> => {
            neu.gesendet = true;
            if (!neu.landschaften || neu.controller.signal.aborted) {
                sammlungen.delete(route);
                return { landschaften: undefined, unterwegs: undefined };
            }
            const { antwort, gedrosselt } = await frageLandschaften(
                route,
                neu.controller.signal,
                neu.unterwegs,
                fetcher,
            );
            neu.fertig = true;
            if (antwort === null && sammlungen.get(route) === neu) sammlungen.delete(route);
            return {
                landschaften: antwort,
                unterwegs:
                    neu.unterwegs === undefined ? undefined : (antwort?.unterwegs ?? (gedrosselt ? null : undefined)),
            };
        });
        queueMicrotask(senden);
        sammlungen.set(route, neu);
        sammlung = neu;
    }
    const offen = sammlung;
    if (!offen.gesendet) {
        if (teil.landschaften) offen.landschaften = true;
        if (teil.unterwegs !== undefined) offen.unterwegs = teil.unterwegs;
    } else if (
        (teil.landschaften && !offen.landschaften) ||
        (teil.unterwegs !== undefined && offen.unterwegs === undefined)
    ) {
        // Zu spät für die gemeinsame Frage: Der Teil fehlt in der Antwort, der Leser fragt selbst.
        return Promise.resolve({ landschaften: undefined, unterwegs: undefined });
    }
    offen.leser += 1;
    const geht = (): void => {
        offen.leser -= 1;
        if (offen.leser > 0 || offen.fertig) return;
        offen.controller.abort();
        if (sammlungen.get(route) === offen) sammlungen.delete(route);
    };
    if (signal.aborted) geht();
    else signal.addEventListener("abort", geht, { once: true });
    return offen.antwort;
}

/**
 * Die Zeilen zur jeweils gezeigten Route. Eine neue Route bricht die Frage nach der alten ab, samt ihrer Pausen,
 * ebenso der Abbau des Planers; die Sprache zu wechseln fragt nicht neu, sondern benennt nur neu.
 */
export function useRouteLandscapes(route: () => RouteResponse | null): { lines: ComputedRef<LandscapeLines | null> } {
    const data = shallowRef<{ route: RouteResponse; answer: RouteLandscapesResponse } | null>(null);
    let controller: AbortController | undefined;
    watch(
        route,
        async (current) => {
            controller?.abort();
            if (!current?.found || current.stages.length === 0) {
                data.value = null;
                return;
            }
            const own = new AbortController();
            controller = own;
            // Die gemeinsame Frage mit dem Unterwegs der Routendetails (WI-0292); ohne Antwort bleibt die Zeile weg.
            const gemeinsam = (await frageBeigaben(current, own.signal, { landschaften: true })).landschaften;
            if (controller !== own) return;
            const answer = gemeinsam === undefined ? await fetchRouteLandscapes(current, own.signal) : gemeinsam;
            if (controller === own) data.value = answer ? { route: current, answer } : null;
        },
        { immediate: true },
    );
    onScopeDispose(() => controller?.abort());
    const lines = computed((): LandscapeLines | null => {
        const shown = data.value;
        if (!shown || shown.route !== route()) return null;
        const { stages, regions } = shown.answer;
        return {
            territories: shown.answer.territories ?? null,
            ...(shown.answer.sprachen === undefined
                ? {}
                : { sprachen: shown.answer.sprachen, routeSprachen: routeSprachen(stages, shown.answer.sprachen) }),
            route: landscapeLine(stages, regions, landscapeTypeLabel, "encounter"),
            stages: stages.map((stage) => landscapeLine([stage], regions)),
        };
    });
    return { lines };
}
