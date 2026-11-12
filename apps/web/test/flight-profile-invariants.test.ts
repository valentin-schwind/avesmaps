import { describe, expect, it, vi } from "vitest";
import {
    AVENTURIA_FLIGHT_CARTOGRAPHY,
    AVENTURIA_TRAVEL_MODEL,
    airCeilingAbsolute,
    airMaxAboveGround,
    flightSurcharge,
} from "@avesmaps3d/shared";
import { flightProfile, MERCATOR_PER_SCHRITT, MERCATOR_PER_UNIT } from "../src/map/flight-path.ts";

/**
 * Die Höhenregel der Flugbahn im Raum als Invariante (WI-0061, Plan 11.54 „Air Route respektiert Höhenregel“):
 * `flightProfile` ist die eine Rechnung für Bahn und Pfeil. Die Regel (WI-0051 F3, Betreiber 2026-09-28 „A“, die
 * Obergrenze Betreiber 2026-10-04): Die Obergrenze je Probe ist min(5.000 über dem Meer, Boden + 10 × Reisehöhe); der
 * Bedarf je Probe ist min(Obergrenze, max(Reisehöhe, Boden + Mindestabstand)) über dem Meer; die Bahn steigt am Start
 * vom Boden und sinkt am Ziel auf den Boden, beides mit 1 : 4, und fliegt nie unter dem Boden.
 *
 * Geprüft wird an erzeugten Fällen aus einem festen Seed: zufällige Böden (Ebene, Grate, Plateaus, auch über der
 * Höchstflughöhe, am Start und am Ziel), die Reisehöhen aller Flugmittel und des eigenen, Längen von einer bis 300
 * Einheiten, Überhöhungen. Die begründeten Brücken, an denen die Bahn den Bedarf verfehlt: die Rampen an Start und
 * Ziel und ein Boden, der selbst über der Höchstflughöhe liegt (dort fliegt sie auf ihm). Wo die Obergrenze Halten und
 * Steigung übertrifft (steile Wand), folgt die Bahn dem Boden mit 10 × Reisehöhe Abstand: dort gilt die 1 : 4 nicht.
 *
 * Der Umfang: kleine Teilmenge in `npm test`, voller Satz mit `npm run gate:routing-invariants`.
 */

const FULL = process.env["AVESMAPS_INVARIANTS"] === "full";
const cases = FULL ? 20_000 : 500;
// Der volle Satz rechnet 20.000 Fälle: allein knapp 4 s, im Gesamtlauf des Gates unter Last über den 5 s der Vorgabe.
if (FULL) vi.setConfig({ testTimeout: 120_000 });

/** Ein kleiner, reproduzierbarer Zufall (mulberry32); derselbe wie `apps/server/test/support/invariants.ts`. */
function random(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const S = MERCATOR_PER_SCHRITT;
const E = MERCATOR_PER_UNIT;
const STEIGUNG = AVENTURIA_FLIGHT_CARTOGRAPHY.bahn.steigung;
const CLEARANCE = AVENTURIA_TRAVEL_MODEL.flug.wert.mindestabstandSchritt;
/** Die Reisehöhen der Flugmittel des Reisemodells, dazu einige eigene. */
const CRUISES = [...AVENTURIA_TRAVEL_MODEL.flug.wert.profile.map((profile) => profile.reisehoehe), 30, 60, 250, 2000];
/** Float32 der Textur: ein Hundertstel Schritt Rundung. */
const EPS = 0.02;

interface Fall {
    name: string;
    ground: Float32Array;
    length: number;
    cruise: number;
    /** Höchste Höhe über Grund und Höchstflughöhe über dem Meer. */
    reach: number;
    ceiling: number;
    exaggeration: number;
    /** Schritt je Probe in Mercator. */
    step: number;
}

/** Ein zufälliger Fall: Boden aus Ebenen, Graten und Plateaus, Länge, Flugmittel, Überhöhung. */
function fall(seed: number): Fall {
    const next = random(seed);
    const cruise = CRUISES[Math.floor(next() * CRUISES.length)] as number;
    const ceiling = airCeilingAbsolute(AVENTURIA_TRAVEL_MODEL);
    const reach = airMaxAboveGround(AVENTURIA_TRAVEL_MODEL, cruise);
    const samples = 40 + Math.floor(next() * 1500);
    const lengthUnits = 1 + next() * 299;
    const ground = new Float32Array(samples + 1);
    // Grate und Plateaus: Höhen von null bis über die Höchstflughöhe, Breiten von einer Probe bis einem Fünftel.
    const ridges = Math.floor(next() * 7);
    for (let ridge = 0; ridge < ridges; ridge += 1) {
        const from = Math.floor(next() * samples);
        const to = Math.min(samples, from + 1 + Math.floor(next() * (samples / 5)));
        const high = next() < 0.3 ? ceiling * (1 + next()) : next() * Math.max(ceiling, 3000);
        for (let k = from; k <= to; k += 1) ground[k] = Math.max(ground[k] as number, high * S);
    }
    // Manchmal liegt ein Wegpunkt selbst im Gebirge, auch über der Höchstflughöhe.
    if (next() < 0.25) ground[0] = (next() < 0.5 ? ceiling * 1.2 : next() * 2500) * S;
    if (next() < 0.25) ground[samples] = (next() < 0.5 ? ceiling * 1.2 : next() * 2500) * S;
    return {
        name: `Fall ${String(seed)} (Reisehöhe ${String(cruise)}, ${String(samples + 1)} Proben, ${lengthUnits.toFixed(1)} E)`,
        ground,
        length: lengthUnits * E,
        cruise: cruise * S,
        reach: reach * S,
        ceiling: ceiling * S,
        exaggeration: [1, 1, 0.5, 2, 3.5][Math.floor(next() * 5)] as number,
        step: (lengthUnits * E) / samples,
    };
}

describe("Das Höhenprofil der Flugbahn hält die Höhenregel (zufällige Böden, alle Flugmittel)", () => {
    it(`🔴 nie unter dem Boden, nie über 5.000 und nie über Boden + 10 × Reisehöhe (außer auf einem höheren Boden), nie unter dem Bedarf (außer in den Rampen) - ${String(cases)} Fälle`, () => {
        let airborne = 0;
        let ramps = 0;
        let mountains = 0;
        let capped = 0;
        let reachBound = 0;
        // Verstöße werden gesammelt und am Ende einmal gemeldet: `expect` je Probe kostete Sekunden.
        const violations: string[] = [];
        const require = (ok: boolean, message: () => string): void => {
            if (!ok && violations.length < 5) violations.push(message());
        };
        for (let seed = 1; seed <= cases; seed += 1) {
            const one = fall(seed * 2654435761);
            const track = {
                ground: one.ground,
                length: one.length,
                cruise: one.cruise,
                reach: one.reach,
                ceiling: one.ceiling,
                clearance: CLEARANCE * S,
            };
            const out = flightProfile(track, one.exaggeration);
            const last = one.ground.length - 1;
            require(out.length === one.ground.length, () => `${one.name}: Länge des Profils`);
            const schritt = one.length / last;
            const cruise = one.cruise / S;
            const reach = one.reach / S;
            const ceiling = one.ceiling / S;
            /** Die Obergrenze an einer Probe: höchstens 5.000 über dem Meer, höchstens `reach` über dem Boden. */
            const capAt = (k: number): number => Math.min(ceiling, (one.ground[k] as number) / S + reach);
            for (let k = 0; k <= last; k += 1) {
                // Alles in Schritt über dem Meer, ohne Überhöhung.
                const z = (out[k] as number) / one.exaggeration / S;
                const ground = (one.ground[k] as number) / S;
                const where = `${one.name}, Probe ${String(k)}`;
                require(Number.isFinite(z), () => `${where}: keine Zahl`);
                // Nie unter dem Boden.
                require(z >= ground - EPS, () => `${where}: ${z.toFixed(2)} unter dem Boden ${ground.toFixed(2)}`);
                // Nie über der Höchstflughöhe (5.000 über dem Meer) und nie über Boden + 10 × Reisehöhe, es sei denn, der
                // Boden selbst liegt darüber: Dort fliegt sie auf ihm.
                require(z <= Math.max(ceiling, ground) + EPS, () =>
                    `${where}: ${z.toFixed(2)} über der Höchstflughöhe ${ceiling.toFixed(2)}`);
                require(z <= Math.max(capAt(k), ground) + EPS, () =>
                    `${where}: ${z.toFixed(2)} über Boden ${ground.toFixed(2)} + ${reach.toFixed(2)} (10 × Reisehöhe)`);
                if (ground > ceiling) mountains += 1;
                // Die Obergrenze wirkt wirklich: Die Bahn liegt an ihr, wo Halten und Steigung mehr verlangten.
                if (z >= capAt(k) - EPS && capAt(k) > ground + EPS) {
                    capped += 1;
                    if (capAt(k) < ceiling - EPS) reachBound += 1;
                }
                // Nie unter dem Bedarf, es sei denn, die Rampe am Start oder Ziel verlangt es (Steigen und Sinken mit 1 : 4).
                const need = Math.min(capAt(k), Math.max(cruise, ground + CLEARANCE));
                const ramp = Math.min(
                    (one.ground[0] as number) / S + (STEIGUNG * (schritt * k)) / S,
                    (one.ground[last] as number) / S + (STEIGUNG * (one.length - schritt * k)) / S,
                );
                require(z >= Math.min(need, ramp) - EPS, () =>
                    `${where}: ${z.toFixed(2)} unter dem Bedarf ${need.toFixed(2)} (Rampe ${ramp.toFixed(2)})`);
                if (ramp < need) ramps += 1;
                // Frei fliegend (über dem Boden, nicht an der Obergrenze) steigt und sinkt sie höchstens mit 1 : 4.
                if (k > 0) {
                    const before = (out[k - 1] as number) / one.exaggeration / S;
                    const groundBefore = (one.ground[k - 1] as number) / S;
                    const free = (height: number, floor: number, cap: number): boolean =>
                        height > floor + EPS && height < cap - EPS;
                    if (free(z, ground, capAt(k)) && free(before, groundBefore, capAt(k - 1))) {
                        airborne += 1;
                        const limit = ((STEIGUNG * schritt) / S) * (1 + 1e-4) + EPS;
                        require(Math.abs(z - before) <= limit, () =>
                            `${where}: Steigung ${Math.abs(z - before).toFixed(2)} über ${limit.toFixed(2)}`);
                    }
                }
            }
            // Start und Ziel liegen auf dem Boden der Wegpunkte.
            require(Math.abs((out[0] as number) / one.exaggeration / S - (one.ground[0] as number) / S) <= EPS, () =>
                `${one.name}: Start nicht auf dem Boden`);
            require(Math.abs((out[last] as number) / one.exaggeration / S - (one.ground[last] as number) / S) <=
                EPS, () => `${one.name}: Ziel nicht auf dem Boden`);
        }
        expect(violations).toEqual([]);
        // Der Test prüft etwas: freie Flüge, Rampen und Böden über der Höchstflughöhe kommen vor.
        expect(airborne).toBeGreaterThan(cases * 5);
        expect(ramps).toBeGreaterThan(cases);
        expect(mountains).toBeGreaterThan(0);
        // Beide Obergrenzen wirken: die absolute (5.000) und die über Grund (10 × Reisehöhe, nur bei kleiner Reisehöhe).
        expect(capped).toBeGreaterThan(cases);
        expect(reachBound).toBeGreaterThan(0);
    });

    it(`🔴 F4: Der Zuschlag über der Reisehöhe ist nie negativ, nie größer als die Obergrenze erlaubt, 0 auf der Standardflughöhe und 0 ohne Überstand - ${String(cases)} Fälle`, () => {
        const climbFactor = AVENTURIA_TRAVEL_MODEL.flug.wert.steigkostenFaktor;
        const holdFactor = AVENTURIA_TRAVEL_MODEL.flug.wert.haltekostenFaktor;
        let costly = 0;
        let free = 0;
        const violations: string[] = [];
        const require = (ok: boolean, message: () => string): void => {
            if (!ok && violations.length < 5) violations.push(message());
        };
        for (let seed = 1; seed <= cases; seed += 1) {
            const one = fall(seed * 2654435761);
            const track = {
                ground: one.ground,
                length: one.length,
                cruise: one.cruise,
                reach: one.reach,
                ceiling: one.ceiling,
                clearance: CLEARANCE * S,
            };
            // Ohne Überhöhung ist die Höhe der Bahn in Mercator die in Schritt, mal `S`.
            const out = flightProfile(track, 1);
            const ground = Array.from(one.ground, (value) => value / S);
            const altitude = Array.from(out, (value) => value / S);
            const length = one.length / S;
            const reach = one.reach / S;
            const standard = Math.max(one.cruise / S, CLEARANCE);
            const input = { ground, altitude, length, standard, scale: reach, climbFactor, holdFactor };
            const result = flightSurcharge(input);
            // Nie negativ, endlich.
            require(Number.isFinite(result.climb) &&
                Number.isFinite(result.hold) &&
                result.climb >= 0 &&
                result.hold >= 0, () => `${one.name}: Zuschlag ${String(result.climb)} / ${String(result.hold)}`);
            require(result.peak >= 0, () => `${one.name}: Überstand ${String(result.peak)}`);
            // Der Überstand ist höchstens die größte Höhe über Grund minus die Standardflughöhe (Gelände über der Höchstflughöhe: 0).
            require(result.peak <= Math.max(0, reach - standard) + EPS, () =>
                `${one.name}: Überstand ${result.peak.toFixed(2)} über ${(reach - standard).toFixed(2)}`);
            // Halten kostet höchstens die Strecke mal Überstand / scale mal Faktor; Steigen höchstens Faktor mal alles, was die Bahn steigt.
            require(result.hold <= (holdFactor * length * result.peak) / reach + 1e-6, () =>
                `${one.name}: Halten ${result.hold.toFixed(2)} über der Grenze`);
            // Auf der Standardflughöhe über Grund kostet nichts, auch an steilem Gelände (die absolute Höhe steigt dabei).
            const standardFlug = flightSurcharge({ ...input, altitude: ground.map((value) => value + standard) });
            require(standardFlug.climb === 0 && standardFlug.hold === 0 && standardFlug.peak === 0, () =>
                `${one.name}: Standardflughöhe kostet ${String(standardFlug.climb)} / ${String(standardFlug.hold)}`);
            // Ohne Überstand (über der Rundung der Float32-Textur, `EPS`) kein Zuschlag: Liegt die Bahn nirgends über
            // Boden + Standard, kostet höchstens das Rauschen der Rundung, einige hundertstel Schritt.
            const over = altitude.some((value, k) => value - (ground[k] as number) - standard > EPS);
            if (!over) {
                free += 1;
                require(result.climb <= climbFactor * EPS * 5 &&
                    result.hold <= (holdFactor * length * EPS) / reach, () =>
                    `${one.name}: ohne Überstand ${String(result.climb)} / ${String(result.hold)}`);
            } else if (result.climb + result.hold > 0) {
                costly += 1;
            }
            // Linear in den Faktoren: doppelt so teuer bei doppelten Faktoren, kostenlos bei 0.
            const doppelt = flightSurcharge({ ...input, climbFactor: 2 * climbFactor, holdFactor: 2 * holdFactor });
            require(Math.abs(doppelt.climb - 2 * result.climb) < 1e-6 &&
                Math.abs(doppelt.hold - 2 * result.hold) < 1e-6, () => `${one.name}: nicht linear in den Faktoren`);
            const nichts = flightSurcharge({ ...input, climbFactor: 0, holdFactor: 0 });
            require(nichts.climb === 0 && nichts.hold === 0, () => `${one.name}: Faktor 0 kostet`);
        }
        expect(violations).toEqual([]);
        // Der Test prüft etwas: Es gibt Flüge mit und ohne Zuschlag.
        expect(costly).toBeGreaterThan(cases / 10);
        expect(free).toBeGreaterThan(cases / 20);
    });
});
