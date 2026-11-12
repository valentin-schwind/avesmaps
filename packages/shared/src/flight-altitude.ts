/**
 * Die Höhe der Flugbahn über der Strecke (WI-0051 F3, Betreiber 2026-09-28; WI-0065 Nachtrag 2026-10-03): die EINE
 * Rechnung für die Bahn auf der Karte (`apps/web/src/map/flight-path.ts`) und für die rote Linie im Höhenprofil des
 * Routenplaners (Server, `water-profile.ts`). Sie kennt keine Karte und keinen Browser; alle Längen und Höhen stehen
 * in EINER Einheit, auf der Karte Mercator, im Profil Schritt (Länge der Strecke dann in Schritt, nicht in Karteneinheiten).
 *
 * Regel des Betreibers: „zuerst steigt das flugmittel auf die durchschnittliche flughöhe, erst wenn hindernisse
 * kommen, steigt das fluggerät bis 1000% an. wenn es dann nicht ausweichen kann, weicht es aus“. Ausgewichen ist
 * schon: Den Weg um zu hohe Gebirge rechnet F2. Die 1.000 % gelten über Grund, dazu gilt eine absolute Höchstflughöhe
 * (Betreiber 2026-10-04: „das flugmittel [erreicht] das 10x der höhe über grund“, „5000 schritt als max. flughöhe“).
 *
 * - **Obergrenze je Probe:** min(Höchstflughöhe über dem Meer, Boden + `reach`), `reach` die höchste Höhe über Grund.
 * - **Bedarf je Probe:** min(Obergrenze, max(Reisehöhe, Boden + Mindestabstand)).
 * - **Höhe halten:** Der Bedarf gilt als Höchstwert über ± `hold`, damit das Flugmittel über nahe beieinander
 *   liegenden Graten nicht in jedes Tal sinkt.
 * - **Steigen und Sinken** mit `slope` (1 : 4 = 0,25): die obere Hülle des Bedarfs mit dieser Steigung, am Start vom
 *   Boden auf, am Ziel auf den Boden. Nie unter dem Boden.
 * - **Die Obergrenze gewinnt über Halten und Steigung** (nur dort, wo beide mehr verlangten): Hält ein Nachbar den
 *   Bedarf höher, als das Flugmittel an dieser Stelle über dem Boden steigen darf, oder ist die Wand steiler als
 *   `slope`, folgt die Bahn der Obergrenze, also dem Boden mit `reach` Abstand. Nur der Boden selbst steht darüber:
 *   Liegt der Boden über der Höchstflughöhe (Start oder Ziel im Hochgebirge, eine erzwungene Querung), liegt die
 *   Bahn auf ihm.
 */
export interface FlightAltitudeInput {
    /** Die Bodenhöhe je Probe, in gleichen Abständen vom Start bis zum Ziel (mindestens eine). */
    ground: ArrayLike<number>;
    /** Länge der Strecke in der Einheit der Höhen. */
    length: number;
    /** Reisehöhe über Grund. */
    cruise: number;
    /** Höchstflughöhe über dem Meer (für alle Flugmittel gleich, `airCeilingAbsolute`). */
    ceiling: number;
    /** Die höchste Höhe über dem Boden direkt unter dem Flugmittel (`airMaxAboveGround`). */
    reach: number;
    /** Mindestabstand zum Boden. */
    clearance: number;
    /** Das Fenster, über das der Bedarf gehalten wird, je Seite, in der Einheit der Länge (`bahn.haltenEinheiten`). */
    hold: number;
    /** Steigen und Sinken, Höhe je Länge (`bahn.steigung`). */
    slope: number;
}

/** Die Höhe der Bahn je Probe, in der Einheit der Eingabe, ohne Überhöhung; so viele Werte wie `ground`. */
export function flightAltitude(input: FlightAltitudeInput): Float64Array {
    const { ground, length, cruise, ceiling, reach, clearance, hold, slope } = input;
    const letzte = ground.length - 1;
    const out = new Float64Array(ground.length);
    if (letzte < 1) {
        out.fill(ground[0] ?? 0);
        return out;
    }
    const schritt = length / letzte;
    const boden = (k: number): number => ground[k] as number;
    // Höher als das Meer-Maß und höher als `reach` über dem Boden steigt das Flugmittel nirgends.
    const grenze = (k: number): number => Math.min(ceiling, boden(k) + reach);
    // Der Bedarf je Probe, dann gehalten über das Fenster.
    const bedarf = new Float64Array(ground.length);
    for (let k = 0; k <= letzte; k += 1) bedarf[k] = Math.min(grenze(k), Math.max(cruise, boden(k) + clearance));
    const fenster = schritt > 0 ? Math.min(letzte, Math.round(hold / schritt)) : 0;
    const gehalten = new Float64Array(ground.length);
    for (let k = 0; k <= letzte; k += 1) {
        let hoechster = Number.NEGATIVE_INFINITY;
        for (let j = Math.max(0, k - fenster); j <= Math.min(letzte, k + fenster); j += 1) {
            hoechster = Math.max(hoechster, bedarf[j] as number);
        }
        gehalten[k] = hoechster;
    }
    // Die obere Hülle mit der Steigung: vorwärts sinkt sie höchstens so steil, rückwärts steigt sie so.
    const gefaelle = slope * schritt;
    const vor = Float64Array.from(gehalten);
    for (let k = 1; k <= letzte; k += 1) vor[k] = Math.max(vor[k] as number, (vor[k - 1] as number) - gefaelle);
    const zurueck = Float64Array.from(gehalten);
    for (let k = letzte - 1; k >= 0; k -= 1) {
        zurueck[k] = Math.max(zurueck[k] as number, (zurueck[k + 1] as number) - gefaelle);
    }
    for (let k = 0; k <= letzte; k += 1) {
        const s = schritt * k;
        const huelle = Math.max(vor[k] as number, zurueck[k] as number);
        // Am Start vom Boden auf, am Ziel auf den Boden, beides mit derselben Steigung.
        const rampen = Math.min(boden(0) + slope * s, boden(letzte) + slope * (length - s));
        // Die Obergrenze gewinnt über Halten und Steigung; nur der Boden selbst steht darüber.
        out[k] = Math.max(Math.min(huelle, rampen, grenze(k)), boden(k));
    }
    return out;
}

/**
 * Was die Bahn über der Reisehöhe kostet (WI-0051 F4, Betreiber 2026-10-04): Ein Aufstieg über die durchschnittliche
 * Flughöhe soll in die Kosten fließen, „aber auch die flughöhe soll kosten bis wieder die durchschnittliche flughöhe
 * erreicht ist (die ist der standard und der aufstieg zur durchschnittlichen flughöhe kostet nichts)“.
 *
 * Bezug ist die Standardflughöhe über Grund (`standard`; bei den Flugmitteln ihre Reisehöhe, mindestens der
 * Mindestabstand, denn tiefer fliegt die Bahn nie: `airStandardHeight`). Auf ihr zu fliegen kostet nichts, auch wenn
 * die absolute Höhe dabei mit dem Gelände steigt; ebenso der Aufstieg vom Start auf sie.
 *
 * - **Überstand** je Probe: Höhe der Bahn über dem Boden minus `standard`, wo positiv, sonst 0.
 * - **Steigen** über die Reisehöhe: Jeder Schritt, um den der Überstand wächst, während die Bahn selbst steigt, kostet
 *   `climbFactor` Schritt als Strecke. Wächst der Überstand nur, weil der Boden unter der Bahn abfällt (hinter einem
 *   Grat), steigt das Flugmittel nicht, es sinkt oder hält die Höhe, und das ist frei. Je Probe zählt darum
 *   min(Steigung der Bahn, Zuwachs des Überstands), nie negativ.
 * - **Halten** über der Reisehöhe, auch beim Sinken zurück: Solange der Überstand positiv ist, kostet jede Strecke
 *   zusätzlich Strecke × Überstand / `scale` × `holdFactor` (`scale` ist die größte Höhe über Grund, 10 × Reisehöhe).
 * - Beides ist nie negativ; wo die Bahn auf oder unter der Standardflughöhe liegt, ist es 0.
 *
 * Alle Längen und Höhen in EINER Einheit (im Server Schritt); das Ergebnis ist eine zusätzliche STRECKE in dieser
 * Einheit. Die Zeit daraus rechnet `airSurchargeHours` (`air.ts`).
 */
export interface FlightSurchargeInput {
    /** Der Boden je Probe, in gleichen Abständen vom Start bis zum Ziel. */
    ground: ArrayLike<number>;
    /** Die Höhe der Bahn je Probe (`flightAltitude`), gleich viele Werte wie `ground`. */
    altitude: ArrayLike<number>;
    /** Länge der Strecke in der Einheit der Höhen. */
    length: number;
    /** Die Standardflughöhe über Grund: der Bezug der Kosten. */
    standard: number;
    /** Die größte Höhe über Grund (`airMaxAboveGround`, 10 × Reisehöhe): der Nenner des Haltens. */
    scale: number;
    /** Strecke je Schritt Steigen über die Reisehöhe (`flug.wert.steigkostenFaktor`). */
    climbFactor: number;
    /** Zuschlag auf die Strecke je Überstand / `scale` (`flug.wert.haltekostenFaktor`). */
    holdFactor: number;
}

export interface FlightSurcharge {
    /** Zusätzliche Strecke für das Steigen über die Reisehöhe. */
    climb: number;
    /** Zusätzliche Strecke für das Halten über der Reisehöhe. */
    hold: number;
    /** Der größte Überstand der Bahn über Boden + Standardflughöhe. */
    peak: number;
}

export function flightSurcharge(input: FlightSurchargeInput): FlightSurcharge {
    const { ground, altitude, length, standard, scale, climbFactor, holdFactor } = input;
    const letzte = ground.length - 1;
    if (letzte < 1 || altitude.length !== ground.length) return { climb: 0, hold: 0, peak: 0 };
    const schritt = length / letzte;
    const nenner = Math.max(scale, 1e-9);
    const ueber = (k: number): number => Math.max(0, (altitude[k] as number) - (ground[k] as number) - standard);
    let steigen = 0;
    let halten = 0;
    let davor = ueber(0);
    let hoechster = davor;
    for (let k = 1; k <= letzte; k += 1) {
        const jetzt = ueber(k);
        const bahnSteigt = (altitude[k] as number) - (altitude[k - 1] as number);
        steigen += Math.max(0, Math.min(bahnSteigt, jetzt - davor));
        halten += (schritt * (davor + jetzt)) / 2 / nenner;
        hoechster = Math.max(hoechster, jetzt);
        davor = jetzt;
    }
    return { climb: steigen * climbFactor, hold: halten * holdFactor, peak: hoechster };
}
