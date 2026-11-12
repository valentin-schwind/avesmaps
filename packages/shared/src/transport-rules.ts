import { conditionGround, WATER_KINDS, type CoastProfile, type TravelModel, type WaterKind } from "./travel-model.ts";
import { DAYS_PER_YEAR, type Season } from "./calendar.ts";

/**
 * Regeln je Transportmittel, die über Tempo und Reisetag hinausgehen (WI-0069): der Strömungsfaktor aus der
 * Tagesleistung, der Boden, ohne den ein Mittel nicht fährt (Schlitten), die Gewässer eines Seeschiffs
 * (Ruderboot) und unter welchem Schiff der Seegraph die Seereisen hält. Jede liest das Reisemodell; keine
 * kennt eine Kennung.
 */

/**
 * Eiltempo (WI-0078): der Faktor, den ein Mittel auf einer Wegart anschlägt - 1, wo es keine Regel gibt. Er ist der
 * Faktor der Geographia (1,5 beziehungsweise 1,25) und gilt an einem Eiltag in VOLLER Höhe; welcher Reisetag ein
 * Eiltag ist, sagt `isHurryDay`. 🔴 Keine Kennung im Router: Wer eilt und wo, steht allein im Reisemodell.
 */
export function hurryFactor(model: TravelModel, transport: string, pathType: string): number {
    const rule = model.eiltempo.wert.mittel[transport];
    if (rule === undefined || !rule.wegarten.includes(pathType)) return 1;
    return rule.faktor;
}

/**
 * Ist der Reisetag mit der Nummer `day` (0 für den ersten) ein Eiltag? (Betreiber 2026-10-05: „das was in der GA
 * steht“; Geographia S. 123: auf Dauer kann ein Mensch oder Tier „nur jeden zweiten Tag erhöhtes Tempo“ anschlagen.)
 *
 * Die Taktung steht als Zahlenpaar im Reisemodell (`eiltempo.taktung`): von je `reisetage` Reisetagen sind die ersten
 * `eiltage` Eiltage. Mit 2 und 1 heißt das: Tag 1 eilt, Tag 2 nicht, Tag 3 eilt - der erste Tag einer Reise eilt
 * immer, also bekommt eine Reise, die an einem Tag endet, den vollen Faktor.
 */
export function isHurryDay(model: TravelModel, day: number): boolean {
    const { reisetage, eiltage } = model.eiltempo.wert.taktung;
    if (reisetage <= 0 || eiltage <= 0) return false;
    if (eiltage >= reisetage) return true;
    return ((Math.floor(day) % reisetage) + reisetage) % reisetage < eiltage;
}

/** Der Stand des Reisetagzählers und was ein Abschnitt im Eiltempo wirklich braucht. */
export interface HurryPaced {
    /** Die Stunden, die der Abschnitt braucht: an Eiltagen durch den Faktor geteilt, sonst die normalen. */
    hours: number;
    /** Der Reisetagzähler danach, gebrochen - der Stand, mit dem der nächste Abschnitt beginnt. */
    days: number;
    /** Der wirksame Faktor dieses Abschnitts (`normale Stunden / hours`); GENAU 1, wo nichts geeilt ist. */
    factor: number;
}

/**
 * 🔴 Die Taktung rechnet AM REISETAG, nicht als Anteil (Betreiber 2026-10-05: „das was in der GA steht“).
 *
 * Ein Abschnitt, der normal `hours` Stunden dauert, wird entlang der Reisetage verteilt: Was in einen Eiltag fällt,
 * geht mit dem vollen Faktor, was in einen gewöhnlichen Tag fällt, im normalen Tempo. Überschreitet er eine
 * Tagesgrenze, wird er dort geteilt. Ein Tag ist voll, wenn `dayHours` WIRKLICHE Reisestunden darin liegen - an einem
 * Eiltag kommt man in denselben Stunden weiter, man reist nicht länger (§3 Regel 6).
 *
 * `days` ist der Zähler der Reise, nicht des Abschnitts: Er läuft über Abschnitte, Etappen und Mediengrenzen hinweg
 * weiter, und auch über Abschnitte, die gar nicht eilen dürfen (Pass, Sumpf, Tiefschnee) - ein gesperrter Abschnitt
 * kostet Reisetage wie jeder andere und darf die Taktung nicht verschieben. Der Zähler ist derselbe, mit dem der
 * Reiseplan rechnet (Reisestunden geteilt durch `stageDayHours`); eine neue Wertetafel gibt es nicht.
 *
 * `IMPLEMENTATION DETAIL`: Kein Kalender und kein Ring - der Zähler steht vor dem Abschnitt schon fest, weil die
 * Abschnitte in Fahrtrichtung gerechnet werden. Welcher Tag der erste Eiltag ist, ist nicht erfunden, sondern die
 * Regel: der erste Reisetag (`isHurryDay(0)`).
 */
export function hurryPacedHours(
    model: TravelModel,
    input: { hours: number; dayHours: number; factor: number; days: number },
): HurryPaced {
    const { hours, dayHours, factor } = input;
    const unchanged = { hours, days: input.days, factor: 1 };
    if (!(hours > 0) || !(dayHours > 0) || !Number.isFinite(input.days)) return unchanged;
    if (!(factor > 1)) return { hours, days: input.days + hours / dayHours, factor: 1 };
    let days = input.days;
    /** Noch zu reisende NORMALE Stunden. */
    let left = hours;
    /** Schon verbrauchte WIRKLICHE Stunden. */
    let used = 0;
    let hurried = false;
    // Je Durchgang höchstens eine Tagesgrenze; der Abschnitt überschreitet nie mehr als seine eigenen Tage.
    const rounds = Math.ceil(hours / dayHours) + 2;
    for (let round = 0; left > 0 && round <= rounds; round += 1) {
        const day = Math.floor(days);
        const pace = isHurryDay(model, day) ? factor : 1;
        /** Wirkliche Stunden bis zum Ende dieses Reisetags - und die normalen Stunden, die darin Platz haben. */
        const room = (day + 1 - days) * dayHours;
        if (room <= dayHours * 1e-12) {
            days = day + 1;
            continue;
        }
        const fits = room * pace;
        if (left <= fits) {
            used += left / pace;
            days += left / pace / dayHours;
            if (pace > 1) hurried = true;
            left = 0;
            break;
        }
        used += room;
        days = day + 1;
        left -= fits;
        if (pace > 1) hurried = true;
    }
    // Ein Rest kann nur aus der Rundenschranke kommen; er geht im normalen Tempo, damit nie Zeit verschwindet.
    if (left > 0) {
        used += left;
        days += left / dayHours;
    }
    return hurried ? { hours: used, days, factor: hours / used } : { hours, days, factor: 1 };
}

/**
 * Vereitelt dieser Boden das Eiltempo? Aufgeweichter Boden, Tiefschnee und Eis tun es (GA S. 123, Betreiber F1);
 * der Schlitten ist von Schnee und Eis ausgenommen, weil er sie gerade braucht (`bodenAusnahme`).
 */
export function hurryBlockedByGround(model: TravelModel, transport: string, condition: string): boolean {
    const rules = model.eiltempo.wert;
    if (!rules.bodenSperre.includes(condition)) return false;
    return !(rules.bodenAusnahme[transport] ?? []).includes(condition);
}

/** Die Landschaftsarten (`region_type`), in denen kein Abschnitt eilt - Sumpf, Dschungel, Urwald, Regenwald. */
export function hurryBlockingLandscapes(model: TravelModel): readonly string[] {
    return model.eiltempo.wert.landschaftSperre;
}

/**
 * Der Strömungsfaktor eines Flussmittels, wenn am Weg keiner gespeichert ist (WI-0069): stromab durch stromauf
 * seiner Tagesleistung (GA S. 129), sonst `stroemungsfaktorVorgabe`. Ein gespeicherter Faktor geht immer vor.
 */
export function transportFlowFactor(model: TravelModel, transport: string): number {
    const day = model.tagesleistung.wert[transport];
    return day?.stromauf === undefined ? model.stroemungsfaktorVorgabe.wert : day.meilen / day.stromauf;
}

/** Die Schneeregel eines Mittels (`bodenPflicht`, Schlitten); null für jedes andere. */
export type GroundRule = TravelModel["bodenPflicht"]["wert"][string];

export function groundRequirement(model: TravelModel, transport: string): GroundRule | null {
    return model.bodenPflicht.wert[transport] ?? null;
}

/** Der Bodenzustand einer Klimazone in einer Jahreszeit (`jahreszeitBoden.tafel`), ohne Rücksicht auf die Wegart. */
export function seasonCondition(model: TravelModel, zone: string | null, season: Season): string | null {
    return zone === null ? null : (model.jahreszeitBoden.wert.tafel[zone]?.[season] ?? null);
}

/** Liegt in dieser Zone und Jahreszeit der Schnee der Regel (Betreiber 2026-10-03: „nur mit Winterschnee“)? */
export function seasonSnow(model: TravelModel, rule: GroundRule, zone: string | null, season: Season): boolean {
    if (!rule.jahreszeiten.includes(season)) return false;
    const condition = seasonCondition(model, zone, season);
    return condition !== null && rule.zustaende.includes(condition);
}

/**
 * Die Schneegrenze in Schritt an einem Tag des Jahres (`schneegrenze`): zur Mitte jeder Jahreszeit der Wert der
 * Tafel, dazwischen linear, über den Jahreswechsel hinweg, auf 100 Schritt gerundet. Null für eine Zone ohne
 * Eintrag. Dieselbe Zahl zeichnet das Höhenprofil und prüft der Router (WI-0065, WI-0069).
 */
export function snowlineHeight(model: TravelModel, zone: string | null | undefined, day: number): number | null {
    const table = model.schneegrenze.wert;
    const levels = zone ? table.zonen[zone] : undefined;
    if (!levels || !Number.isFinite(day)) return null;
    const year = DAYS_PER_YEAR;
    const wrapped = ((((day - 1) % year) + year) % year) + 1;
    const midpoints = table.jahreszeitMitten;
    for (let i = 0; i < midpoints.length; i += 1) {
        const next = (i + 1) % midpoints.length;
        const from = midpoints[i] as number;
        const to = (midpoints[next] as number) + (next === 0 ? year : 0);
        const at = wrapped < from ? wrapped + year : wrapped;
        if (at >= from && at <= to) {
            const a = levels[i] as number;
            const b = levels[next] as number;
            return Math.round((a + ((b - a) * (at - from)) / (to - from)) / 100) * 100;
        }
    }
    return null;
}

/**
 * Der Boden über der Schneegrenze für eine Wegart und ein Mittel (`schneegrenze.bodenDarueber`, Betreiber 2026-10-04
 * „B“): Zustand und Faktor wie beim Boden der Jahreszeit (`conditionGround`). Null, wenn das Reisemodell keinen nennt,
 * die Wegart keinen Boden hat (Wasser) oder der Boden das Mittel nicht bremst.
 */
export function snowlineGround(
    model: TravelModel,
    pathType: string,
    transport: string,
): { condition: string; factor: number } | null {
    return conditionGround(model, model.schneegrenze.wert.bodenDarueber, pathType, transport);
}

/** Die Gewässer eines Seeschiffs im freien Seerouting (`gewaesser`); ohne Eintrag alle. */
export function shipWaters(model: TravelModel, transport: string): readonly WaterKind[] {
    return model.gewaesser.wert[transport] ?? WATER_KINDS;
}

/**
 * Der Küstenabstand eines Seeschiffs, Verweise (`{ wie }`) aufgelöst; null, wenn das Modell keinen kennt oder
 * die Verweise im Kreis laufen.
 */
export function coastProfileOf(model: TravelModel, transport: string): CoastProfile | null {
    const seen = new Set<string>();
    let current = transport;
    while (!seen.has(current)) {
        seen.add(current);
        const entry = model.kuestenfahrt.wert[current];
        if (entry === undefined) return null;
        if (!("wie" in entry)) return entry;
        current = entry.wie;
    }
    return null;
}

/**
 * Unter welchem Seeschiff der Seegraph die Seereisen dieses Schiffs hält (WI-0069): Wer mit dem Küstenabstand
 * eines anderen fährt (`{ wie }`) und dieselben Gewässer befährt, fährt dieselben Wege - der Graph speichert sie
 * einmal. Ein Schiff mit eigenem Abstand oder eigenen Gewässern hat eigene.
 */
export function seaGraphTransport(model: TravelModel, transport: string): string {
    const seen = new Set<string>();
    let current = transport;
    for (;;) {
        seen.add(current);
        const entry = model.kuestenfahrt.wert[current];
        if (entry === undefined || !("wie" in entry) || seen.has(entry.wie)) return current;
        const sameWaters = shipWaters(model, current).join() === shipWaters(model, entry.wie).join();
        if (!sameWaters) return current;
        current = entry.wie;
    }
}

/** Die Seeschiffe, für die der Seegraph eigene Seereisen hält, in der Reihenfolge des Reisemodells. */
export function seaGraphTransports(model: TravelModel): string[] {
    return model.transportmittel.wert.sea.filter((transport) => seaGraphTransport(model, transport) === transport);
}
