import {
    AVENTURIA_TRAVEL_MODEL,
    CLOCK_START,
    clockEnter,
    clockTravel,
    isRestExempt,
    stageDayHours,
    type RouteResponse,
    type RouteStage,
    type TravelModel,
} from "@avesmaps3d/shared";

/**
 * Die Uhr der Reise, noch einmal gelesen (WI-0306): wann jede Etappe beginnt und endet, welche Rast VOR ihr gebucht wird und welche
 * UNTERWEGS fällt, und die Reisetage für das Reisetagebuch. 🔴 Es ist dieselbe Uhr wie die des Servers (`buildRouteStages`,
 * `packages/shared/src/route-stages.ts`), mit denselben Bausteinen (`clockEnter`, `clockTravel`, `stageDayHours`, `isRestExempt`); was
 * sie rechnet, prüft `uhrStimmt` gegen `rest_hours` der Antwort. Stimmt es nicht (ein anderes Reisemodell), nennt das PDF die Rast so,
 * wie der Server sie bucht, und das Tagebuch fällt weg, statt etwas zu erfinden.
 *
 * - **Ein Reisetag** ist ein Tag der Uhr (`floor(Stunden / 24)`, wie `calendarDate`): Tag 0 ist der Tag der Abreise.
 * - **Die Rast in der Etappenliste** steht an der Etappe, NACH der gerastet wird (Entwurf: „Rast heißt Nachtlager oder Liegezeit an
 *   Bord“): Die Rast, die der Server vor der nächsten Etappe bucht, zählt hier zur vorigen; die Rast unterwegs bleibt, wo sie ist.
 * - **Die Nacht** eines Tages hat das Dach der Wegart, auf der der Tag endet (wie die Reisekosten, `travelNights`): an Bord, im
 *   Gasthaus oder im Freien; ohne Unterkunft („im Freien/Zelt“) ist jede Nacht an Land im Freien. Der letzte Tag ist die Ankunft.
 */

type UhrRoute = Pick<RouteResponse, "stages" | "hours_per_day">;

export interface EtappenUhr {
    /** Stunden seit dem Aufbruch, als die Etappe losgeht (nach der Rast davor). */
    beginn: number;
    /** Stunden seit dem Aufbruch bei der Ankunft am Ende der Etappe. */
    ende: number;
    /** Die Rast, die VOR dieser Etappe gebucht wird (die Nacht nach der vorigen). */
    rastDavor: number;
    /** Die Rast, die UNTERWEGS auf dieser Etappe fällt (Nächte mitten in einer langen Etappe). */
    rastUnterwegs: number;
}

export function etappenUhr(route: UhrRoute, model: TravelModel = AVENTURIA_TRAVEL_MODEL): EtappenUhr[] {
    const mitRast = route.hours_per_day < 24;
    let uhr = CLOCK_START;
    return route.stages.map((stage) => {
        const vorher = uhr.hours;
        const frei = isRestExempt(model, stage);
        const drin = frei || !(stage.travel_hours > 1e-9) ? uhr : clockEnter(uhr);
        const schritt = clockTravel(
            drin,
            stage.travel_hours,
            stageDayHours(model, stage.transport, route.hours_per_day),
            frei,
            mitRast,
        );
        uhr = schritt.clock;
        return { beginn: drin.hours, ende: uhr.hours, rastDavor: drin.hours - vorher, rastUnterwegs: schritt.rest };
    });
}

/** Rechnet die Uhr hier, was der Server gebucht hat? Auf Hundertstelstunden, wie die Anzeige. */
export function uhrStimmt(route: UhrRoute, uhr: readonly EtappenUhr[]): boolean {
    return route.stages.every((stage, i) => {
        const eigen = uhr[i];
        return eigen !== undefined && Math.abs(eigen.rastDavor + eigen.rastUnterwegs - stage.rest_hours) < 0.01;
    });
}

/**
 * Die Rast je Etappe, wie die Etappenliste des PDFs sie nennt: die unterwegs und die vor der NÄCHSTEN Etappe. Stimmt die Uhr nicht, die
 * Rast des Servers an ihrer Etappe.
 */
export function rastNachEtappe(route: UhrRoute, model: TravelModel = AVENTURIA_TRAVEL_MODEL): number[] {
    const uhr = etappenUhr(route, model);
    if (!uhrStimmt(route, uhr)) return route.stages.map((stage) => stage.rest_hours);
    return uhr.map((eigen, i) => eigen.rastUnterwegs + (uhr[i + 1]?.rastDavor ?? 0));
}

const tagDer = (stunden: number): number => Math.floor(Math.max(0, stunden) / 24 + 1e-9);

export type Dach = "gasthaus" | "bord" | "frei";

/**
 * Ein Reisetag. Er nennt die Etappen, die an ihm BEGINNEN (wie im Entwurf: „Gareth → Weyring“, auch wenn die Nacht kurz vor Weyring fällt).
 * Eine Etappe, die länger als bis zum nächsten Tag läuft (eine Flussfahrt über Tage), ist `weiter` an dem Tag, an dem sie beginnt, und
 * `ueber` an den Tagen danach.
 */
export interface Reisetag {
    /** 0 ist der Tag der Abreise. */
    tag: number;
    /** Die Etappen, die an diesem Tag beginnen und spätestens am nächsten enden, in Fahrtrichtung. */
    etappen: readonly RouteStage[];
    /** Eine Etappe, die an diesem Tag beginnt und über mehrere Tage läuft. */
    weiter?: RouteStage | undefined;
    /** Die lange Etappe, auf der man an diesem Tag unterwegs ist, ohne dass eine neue beginnt; `ankunft`, wenn sie heute endet. */
    ueber?: RouteStage | undefined;
    ankunftUeber?: boolean;
    /** Die Nacht danach; `undefined` am Tag der Ankunft. */
    nacht?: Dach | undefined;
}

/** Das Dach einer Nacht auf dieser Wegart, wie die Reisekosten es rechnen (`dach` im Reisemodell). */
export function dachVon(typ: string, lodging: string, model: TravelModel = AVENTURIA_TRAVEL_MODEL): Dach {
    const dach = model.reisekosten.dach.wert[typ];
    if (dach === "anBord") return "bord";
    return dach === "gasthaus" && lodging !== "frei" ? "gasthaus" : "frei";
}

/**
 * Die Reisetage für das Reisetagebuch, ein Eintrag je Tag von der Abreise bis zur Ankunft. Leer, wenn die Uhr nicht stimmt (`uhrStimmt`)
 * oder die Route keine Etappe hat. Ein Tag ohne beginnende Etappe liegt auf einer langen Etappe (`ueber`) oder ist ein Rasttag. Die Nacht
 * hat das Dach der Wegart, auf der man zuletzt reist; mit 24 Reisestunden am Tag gibt es keine Rast, die Nacht ist dann die der Wegart.
 */
export function reisetage(route: UhrRoute, lodging: string, model: TravelModel = AVENTURIA_TRAVEL_MODEL): Reisetag[] {
    const stages = route.stages;
    if (stages.length === 0) return [];
    const uhr = etappenUhr(route, model);
    if (!uhrStimmt(route, uhr)) return [];
    const beginn = (i: number): number => tagDer(uhr[i]!.beginn);
    const ende = (i: number): number => tagDer(uhr[i]!.ende);
    const letzterTag = ende(stages.length - 1);
    const tage: Reisetag[] = [];
    let zuletzt: RouteStage | undefined;
    for (let tag = 0; tag <= letzterTag; tag += 1) {
        const heute = stages.map((stage, i) => ({ stage, i })).filter(({ i }) => beginn(i) === tag);
        const kurz = heute.filter(({ i }) => ende(i) <= tag + 1).map(({ stage }) => stage);
        const lang = heute.find(({ i }) => ende(i) > tag + 1)?.stage;
        const ueberStelle = heute.length === 0 ? stages.findIndex((_, i) => beginn(i) < tag && ende(i) >= tag) : -1;
        const ueber = ueberStelle < 0 ? undefined : stages[ueberStelle];
        zuletzt = lang ?? kurz[kurz.length - 1] ?? ueber ?? zuletzt;
        tage.push({
            tag,
            etappen: kurz,
            ...(lang === undefined ? {} : { weiter: lang }),
            ...(ueber === undefined ? {} : { ueber, ankunftUeber: ende(ueberStelle) === tag }),
            nacht: tag === letzterTag || zuletzt === undefined ? undefined : dachVon(zuletzt.type, lodging, model),
        });
    }
    return tage;
}
