import { afterEach, describe, expect, it } from "vitest";
import {
    AVENTURIA_TRAVEL_MODEL,
    buildRouteTravelCosts,
    canonicalSharePayload,
    travelNights,
    type BorderCount,
    type RouteResponse,
    type RouteStage,
    type SharePayload,
} from "@avesmaps3d/shared";
import { laufText, type Wert } from "../src/controls/wert.ts";
import { de } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";
import { locale } from "../src/i18n/i18n.ts";
import { readPlannerLink, writePlannerLink } from "../src/route-planner/planner-link.ts";
import {
    copyOptions,
    DEFAULT_OPTIONS,
    formatMoney,
    moneyCoins,
    type PlannerOptions,
} from "../src/route-planner/planner-model.ts";
import { routeQuery } from "../src/route-planner/route-client.ts";
import { costView, footnoteNumbering } from "../src/route-planner/travel-cost-view.ts";

/**
 * Unterbringung und Reisekosten im Planer (WI-0042): Feld, Adresse, Kurzlink und die Zeilen des
 * Kastens „Reisekosten je Person“ (Legacy `route-plan.js`, `teilen-unterbringung.test.js`).
 *
 * 🔴 Seit WI-0065 rechnet der Server, der Browser wählt nur (`route-costs-server.test.ts` hält das fest). Die Kosten
 * dieser Tests stehen deshalb als `travel_costs` in einer Antwort, wie der Server sie liefert; gebaut sind sie hier mit
 * derselben Funktion, die der Server aufruft - ein Test darf sie benutzen, `apps/web/src` nicht.
 */

afterEach(() => {
    locale.value = "de";
});

type Stage = Pick<RouteStage, "type" | "transport" | "flow_state" | "distance_units" | "travel_hours">;
const stage = (type: string, transport: string, units: number, hours: number): Stage => ({
    type,
    transport,
    flow_state: null,
    distance_units: units,
    travel_hours: hours,
});

const withOptions = (change: Partial<PlannerOptions>): PlannerOptions => ({
    ...copyOptions(DEFAULT_OPTIONS),
    ...change,
});

/** Zwei Reiche und Grenzen mit Namen und Kurznamen, wie der Server sie in `travel_costs.borders` liefert. */
const borders = (count: number, harbourTollUnknown = false): BorderCount => ({
    count,
    harbourTollUnknown,
    crossings: Array.from({ length: count }, (_, index) => ({
        from: {
            id: `r${String(index)}`,
            name: `Reich ${String(index)} vom Greifenthron`,
            shortName: `R${String(index)}`,
        },
        to: {
            id: `r${String(index + 1)}`,
            name: `Reich ${String(index + 1)} vom Greifenthron`,
            shortName: `R${String(index + 1)}`,
        },
        x: 100 + index,
        y: 50,
    })),
});

/** Eine Antwort des Servers mit Kosten aller Stufen; gebraucht wird von ihr nur `travel_costs`. */
const answerWith = (
    stages: Stage[],
    totalHours: number,
    options: PlannerOptions,
    found: BorderCount | null,
): RouteResponse =>
    ({
        travel_costs: buildRouteTravelCosts(
            AVENTURIA_TRAVEL_MODEL,
            { stages, total_hours: totalHours },
            { landTransport: options.transports.land, hoursPerDay: options.hoursPerDay },
            found,
            found === null ? null : 1049,
        ),
    }) as unknown as RouteResponse;

const viewOf = (stages: Stage[], totalHours: number, options: PlannerOptions, found: BorderCount | null = null) => {
    const result = costView(answerWith(stages, totalHours, options, found), options);
    if (!result) throw new Error("kein Kasten");
    return result;
};
const view = viewOf;

/**
 * Eine Antwort mit genau diesen Nächten: Übernachtung, Verpflegung und Zölle sind gesetzt, nicht gerechnet (die Nächte
 * einer echten Reise stehen in `Die Nächte kommen aus der Antwort`). Das Gasthaus kostet 6 Heller je Nacht im
 * Gemeinschaftszimmer, so ist „8 × …“ gleich „4 S 8 H“.
 */
const forgedNights = (nights: { inn: number; open: number; aboard: number }) => {
    const level = (price: number) => ({
        rows: [
            { key: "lodging", heller: nights.inn * price, status: "SOURCE_RULE", count: nights.inn },
            { key: "food", heller: 300, status: "SOURCE_RULE", count: 3 },
            { key: "tolls", heller: null, status: "UNKNOWN", count: 0 },
        ],
        nights,
        days: 3,
        mounts: 0,
        total: nights.inn * price + 300,
        complete: false,
    });
    return {
        borders: null,
        territory_year_bf: null,
        by_lodging: { frei: level(0), strohsack: level(4), bett: level(6), zimmer: level(15) },
    };
};

describe("Die Unterbringung in Feld, Adresse und Kurzlink", () => {
    it("ist ohne Wahl das Gemeinschaftszimmer (Legacy-Vorgabe)", () => {
        expect(DEFAULT_OPTIONS.lodging).toBe("bett");
    });

    it("🔴 reist in der Adresse mit: gelesen UND geschrieben (Legacy Meldung #103)", () => {
        const options = withOptions({ lodging: "zimmer" });
        const link = writePlannerLink(["A", "B"], options);
        expect(link).toBe("route=A~B&lodging=zimmer");
        expect(readPlannerLink(`?${link}`).options.lodging).toBe("zimmer");
        expect(writePlannerLink(["A", "B"], DEFAULT_OPTIONS)).toBe("route=A~B");
        expect(readPlannerLink("?route=A~B&lodging=palast").options.lodging).toBe("bett");
    });

    it("fragt den Server nicht: Die Unterbringung ändert nur die Kosten", () => {
        expect(routeQuery(["a", "b"], withOptions({ lodging: "frei" }))).toBe(routeQuery(["a", "b"], DEFAULT_OPTIONS));
    });

    it("🔴 der Kurzlink trägt sie mit; die Vorgabe fehlt, ein alter Zustand behält seinen Code", () => {
        const payload: SharePayload = {
            v: 1,
            waypoints: ["p:1:2", "p:3:4"],
            options: {
                optimize: "fastest",
                minimizeTransfers: false,
                enabled: { land: true, river: true, sea: true },
                transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
                hoursPerDay: 8,
            },
            view: { series: "modern", view: "standard", layer: "alle" },
        };
        expect(canonicalSharePayload({ ...payload, options: { ...payload.options, lodging: "bett" } })).toEqual(
            canonicalSharePayload(payload),
        );
        expect(
            canonicalSharePayload({ ...payload, options: { ...payload.options, lodging: "frei" } }).options.lodging,
        ).toBe("frei");
    });
});

describe("Münzen", () => {
    it("„12 D 3 S 4 H“, nie als Dezimalzahl; null ist „—“", () => {
        expect(formatMoney(1234)).toBe("12 D 3 S 4 H");
        expect(formatMoney(6)).toBe("6 H");
        expect(formatMoney(100)).toBe("1 D");
        expect(formatMoney(0)).toBe("—");
    });
});

describe("🔴 Der Kasten „Reisekosten je Person“", () => {
    // 20 Stunden Straße am 8-Stunden-Tag: zwei Nächte, drei Reisetage (52 Stunden).
    const strasse = [stage("Strasse", "groupFoot", 20, 20)];

    it("nennt je Posten Betrag und Herleitung; ohne abgeleitete Gebiete stehen die Zölle als „?“ und „Grenzen hier nicht ermittelbar“, die Summe sagt „ohne Zölle“", () => {
        const result = view(strasse, 52, DEFAULT_OPTIONS);
        // Die Übernachtung hat statt einer Herleitung Unterzeilen (je Dach eine), die übrigen Posten Betrag und Vermerk.
        expect(result.lines.map((line) => [line.label, line.value, line.note])).toEqual([
            ["Übernachtung", "1 S 2 H", ""],
            ["Verpflegung", "2 S 4 H", "3 Reisetage"],
            ["Zölle", "?", "Grenzen hier nicht ermittelbar"],
        ]);
        expect(result.lines.find((line) => line.key === "lodging")?.nights).toEqual([
            {
                kind: "inn",
                text: "2 × im Gemeinschaftszimmer",
                amount: {
                    text: "1 S 2 H",
                    coins: [
                        { zahl: "1", einheit: "S", abstand: " " },
                        { zahl: "2", einheit: "H", abstand: " " },
                    ],
                },
                footnote: 1,
            },
        ]);
        expect(result.lines.find((line) => line.key === "tolls")?.unknown).toBe(true);
        expect(result.total).toBe("3 S 6 H");
        expect(result.totalNote).toBe("2 Nächte, 3 Reisetage — ohne Zölle");
        // Die Kopfzeile trägt nur den Betrag (Betreiber 2026-10-03) und sagt die fehlenden Zölle ebenso.
        expect(result.summary).toBe("3 S 6 H — ohne Zölle");
        expect(result.borders).toBeNull();
    });

    it("🔴 mit Grenzen: Betrag, „{n} Landesgrenzen, als … veranlagt“ je Stufe, die Summe trägt den Zoll und sagt nichts mehr über fehlende Zölle", () => {
        const tolls = (stufe: PlannerOptions["lodging"], count: number) => {
            const result = view(strasse, 52, withOptions({ lodging: stufe }), borders(count));
            const line = result.lines.find((entry) => entry.key === "tolls");
            return { value: line?.value, note: line?.note, unknown: line?.unknown, totalNote: result.totalNote };
        };
        // 3 Grenzen: 3 H · 15 H · 3 D · 15 D (Geographia S. 115: Tagelöhner, Schustergeselle, Söldner, gutverdienend).
        expect(tolls("frei", 3)).toMatchObject({ value: "3 H", note: "3 Landesgrenzen, als Tagelöhner veranlagt" });
        expect(tolls("strohsack", 3)).toMatchObject({
            value: "1 S 5 H",
            note: "3 Landesgrenzen, als Schustergeselle veranlagt",
        });
        expect(tolls("bett", 3)).toMatchObject({ value: "3 D", note: "3 Landesgrenzen, als Söldner veranlagt" });
        expect(tolls("zimmer", 3)).toMatchObject({
            value: "15 D",
            note: "3 Landesgrenzen, als gutverdienender Beruf veranlagt",
            unknown: false,
        });
        // Vollständig: Die Summe sagt nur Nächte und Reisetage.
        expect(tolls("bett", 3).totalNote).toBe("2 Nächte, 3 Reisetage");
        expect(view(strasse, 52, DEFAULT_OPTIONS, borders(3)).total).toBe("3 D 3 S 6 H");
        expect(view(strasse, 52, DEFAULT_OPTIONS, borders(3)).summary).toBe("3 D 3 S 6 H");
    });

    /** Die Unterzeilen der Übernachtung einer Antwort mit genau diesen Nächten und dieser Stufe. */
    const lodgingOf = (nights: { inn: number; open: number; aboard: number }, lodging: PlannerOptions["lodging"]) => {
        const route = { travel_costs: forgedNights(nights) } as unknown as RouteResponse;
        const result = costView(route, withOptions({ lodging }));
        if (!result) throw new Error("kein Kasten");
        return result;
    };
    const nightLines = (result: ReturnType<typeof lodgingOf>) =>
        result.lines
            .find((line) => line.key === "lodging")
            ?.nights?.map((night) => [night.kind, night.text, night.footnote]);

    it("🔴 die Übernachtung: eine Unterzeile je Dach, der Betrag nur an den Gasthausnächten (Betreiber 2026-10-04)", () => {
        // Nur Gasthaus: eine Zeile mit dem Betrag und der Quelle der Preise.
        expect(nightLines(lodgingOf({ inn: 8, open: 0, aboard: 0 }, "bett"))).toEqual([
            ["inn", "8 × im Gemeinschaftszimmer", 1],
        ]);
        // Gemischt: die Nächte im Freien tragen den Grund als Fußnote und keinen Betrag.
        const mixed = lodgingOf({ inn: 8, open: 12, aboard: 0 }, "bett");
        expect(nightLines(mixed)).toEqual([
            ["inn", "8 × im Gemeinschaftszimmer", 1],
            ["open", "12 × im Freien", 2],
        ]);
        expect(
            mixed.lines.find((line) => line.key === "lodging")?.nights?.map((night) => night.amount?.text ?? null),
        ).toEqual(["4 S 8 H", null]);
        // Mit Schiff: die Koje steckt in der Passage, eine eigene Fußnote.
        expect(nightLines(lodgingOf({ inn: 8, open: 12, aboard: 9 }, "bett"))).toEqual([
            ["inn", "8 × im Gemeinschaftszimmer", 1],
            ["open", "12 × im Freien", 2],
            ["aboard", "9 × an Bord", 3],
        ]);
        // Nur im Freien oder nur an Bord: keine Zeile mit Betrag, die Quelle der Preise kommt erst mit der Verpflegung.
        expect(nightLines(lodgingOf({ inn: 0, open: 20, aboard: 0 }, "bett"))).toEqual([["open", "20 × im Freien", 1]]);
        expect(nightLines(lodgingOf({ inn: 0, open: 0, aboard: 3 }, "bett"))).toEqual([["aboard", "3 × an Bord", 1]]);
        // Stufe „im Freien/Zelt“: alle Nächte im Freien sind die Wahl, nichts zu erklären - keine Fußnote an ihnen.
        expect(nightLines(lodgingOf({ inn: 0, open: 20, aboard: 3 }, "frei"))).toEqual([
            ["open", "20 × im Freien", null],
            ["aboard", "3 × an Bord", 1],
        ]);
        // Die anderen Stufen nennen ihr Zimmer.
        expect(nightLines(lodgingOf({ inn: 2, open: 0, aboard: 0 }, "strohsack"))).toEqual([
            ["inn", "2 × im Schlafsaal", 1],
        ]);
        expect(nightLines(lodgingOf({ inn: 2, open: 0, aboard: 0 }, "zimmer"))).toEqual([
            ["inn", "2 × im Einzelzimmer", 1],
        ]);
        // Einzahl, und ohne Nacht kein Betrag und keine Zahl.
        expect(nightLines(lodgingOf({ inn: 1, open: 1, aboard: 0 }, "bett"))).toEqual([
            ["inn", "1 × im Gemeinschaftszimmer", 1],
            ["open", "1 × im Freien", 2],
        ]);
        expect(nightLines(lodgingOf({ inn: 0, open: 0, aboard: 0 }, "bett"))).toEqual([
            ["none", "keine Nacht unterwegs", null],
        ]);
    });

    it("🔴 die Nächte kommen aus der Antwort: Straße dann Pfad ergibt Gasthaus- und Freinächte; die Nächte der Summe bleiben alle", () => {
        // Zwei Tage Straße, dann zwei Tage Pfad (8-Stunden-Tag): Die ersten Nächte enden auf der Straße, die letzten auf dem Pfad.
        const mixed = [stage("Strasse", "groupFoot", 20, 20), stage("Pfad", "groupFoot", 20, 20)];
        const result = viewOf(mixed, 40, DEFAULT_OPTIONS);
        const nights = travelNights(AVENTURIA_TRAVEL_MODEL, mixed, DEFAULT_OPTIONS.hoursPerDay);
        const inn = nights.filter((type) => type === "Strasse").length;
        const open = nights.filter((type) => type === "Pfad").length;
        expect(inn).toBeGreaterThan(0);
        expect(open).toBeGreaterThan(0);
        const lodging = result.lines.find((line) => line.key === "lodging");
        expect(lodging?.nights?.map((night) => night.text)).toEqual([
            `${String(inn)} × im Gemeinschaftszimmer`,
            `${String(open)} × im Freien`,
        ]);
        expect(result.totalNote).toBe(`${String(inn + open)} Nächte, 2 Reisetage — ohne Zölle`);
    });

    it("die Fußnoten: Quelle, Grund und Geographia, Englisch mit denselben Nummern", () => {
        const mixed = lodgingOf({ inn: 8, open: 12, aboard: 9 }, "bett");
        expect(mixed.footnotes.map((note) => [note.number, note.key])).toEqual([
            [1, "source"],
            [2, "open"],
            [3, "aboard"],
            [4, "geographia"],
        ]);
        // Der Wortlaut der Quellenfußnoten ist der des Betreibers (2026-10-04).
        expect(mixed.footnotes.map((note) => note.text)).toEqual([
            "Bett, Verpflegung und Futter aus dem DSA5-Regelwerk und dem Kodex der Helden. 1 Dukat = 10 Silbertaler = 100 Heller.",
            "Im Freien schläft, wer den Reisetag auf Pfad, Pass, Wüstenpfad oder querfeldein beendet.",
            "An Bord schläft, wer den Reisetag auf Fluss oder See beendet; die Koje steckt in der Passage.",
            "Zölle und Passagen nach der Geographia Aventurica.",
        ]);
        locale.value = "en";
        const english = lodgingOf({ inn: 8, open: 12, aboard: 9 }, "bett");
        expect(english.footnotes.map((note) => [note.number, note.key])).toEqual([
            [1, "source"],
            [2, "open"],
            [3, "aboard"],
            [4, "geographia"],
        ]);
        expect(nightLines(english)).toEqual([
            ["inn", "8 × in a shared room", 1],
            ["open", "12 × outdoors", 2],
            ["aboard", "9 × aboard", 3],
        ]);
        // Der englische Wortlaut ist die Übersetzung des deutschen, vom Betreiber abgenommen (2026-10-04), ohne Anrede.
        expect(english.footnotes.map((note) => note.text)).toEqual([
            "Bed, board and fodder come from the DSA5 core rules and the Kodex der Helden. 1 Dukat = 10 Silbertaler = 100 Heller.",
            "A party sleeps outdoors when the day's travel ends on a trail, pass, desert trail or cross-country.",
            "A party sleeps aboard when the day's travel ends on a river or the sea; the berth is part of the passage.",
            "Tolls and passage follow the Geographia Aventurica.",
        ]);
    });

    it("🔴 keine Anrede im Kostenkasten: kein Du, Sie, you - die Regel wird formuliert, nicht dem Leser gesagt (Betreiber 2026-10-04)", () => {
        // „Insgesamt will ich nicht, dass man die spieler mit "Du" oder "Sie" anspricht, sondern einfach die regeln formuliert.“
        const address = {
            de: /\b(?:du|dich|dir|dein\w*|euch|euer\w*|ihr|ihre\w*|ihnen|Sie)\b/,
            en: /\b(?:you|your|yours|yourself|thou|thy)\b/i,
        } as const;
        const ours = (key: string): boolean => key.startsWith("planner.cost.") || key.startsWith("planner.borders.");
        for (const [language, table] of [
            ["de", de],
            ["en", en],
        ] as const) {
            const keys = Object.keys(table).filter(ours);
            // Sonst prüfte der Test nichts: Es gibt diese Schlüssel, und sie sind nicht wenige.
            expect(keys.length).toBeGreaterThan(40);
            for (const key of keys) {
                expect(table[key as keyof typeof table], `${language} ${key}`).not.toMatch(address[language]);
            }
        }
        // Der Satz fürs Lesen („Fußnote 1“) und die Fußnoten am Wert sind Sachsätze: Es schläft „wer“ beziehungsweise „a party“.
        expect(de["planner.cost.fn.open"]).toMatch(/^Im Freien schläft, wer /);
        expect(en["planner.cost.fn.open"]).toMatch(/^A party sleeps /);
    });

    it("🔴 Fußnoten nummeriert nach dem ersten Auftreten von oben nach unten, derselbe Hinweis behält seine Nummer, nur Gezeigtes", () => {
        const numbering = footnoteNumbering();
        // Wer zuerst zitiert, bekommt die 1, auch wenn er im Kasten nicht die „erste“ Art ist.
        expect(numbering.cite("geographia")).toBe(1);
        expect(numbering.cite("source")).toBe(2);
        // Derselbe Hinweis, wieder zitiert: dieselbe Nummer, keine neue.
        expect(numbering.cite("geographia")).toBe(1);
        expect(numbering.cite("source")).toBe(2);
        // Nur zitierte Hinweise stehen in der Liste: „open“ und „aboard“ nie zitiert, also keine Nummer, kein Text.
        expect(numbering.notes().map((note) => [note.number, note.key])).toEqual([
            [1, "geographia"],
            [2, "source"],
        ]);
        // Im Kasten: Eine Straßenreise trägt nur die zwei Quellen - Verpflegung zitiert zuerst die Preise, Zölle die Geographia.
        const road = view(strasse, 52, DEFAULT_OPTIONS);
        expect(road.footnotes.map((note) => [note.number, note.key])).toEqual([
            [1, "source"],
            [2, "geographia"],
        ]);
        expect(road.lines.map((line) => line.footnote)).toEqual([null, 1, 2]);
        // Mit Nächten im Freien rückt die Geographia auf die 3, die Quelle der Preise bleibt an Gasthaus UND Verpflegung die 1.
        const withOpen = lodgingOf({ inn: 2, open: 3, aboard: 0 }, "bett");
        expect(withOpen.lines.map((line) => line.footnote)).toEqual([null, 1, 3]);
        expect(withOpen.footnotes.map((note) => note.key)).toEqual(["source", "open", "geographia"]);
        // Nur im Freien: Der Grund zuerst, dann die Quelle der Preise (an der Verpflegung), dann die Geographia.
        const onlyOpen = lodgingOf({ inn: 0, open: 3, aboard: 0 }, "bett");
        expect(onlyOpen.footnotes.map((note) => note.key)).toEqual(["open", "source", "geographia"]);
        // Im Freien/Zelt gewählt: kein Grund zu erklären, also auch keine Fußnote dafür.
        const tent = lodgingOf({ inn: 0, open: 3, aboard: 0 }, "frei");
        expect(tent.footnotes.map((note) => note.key)).toEqual(["source", "geographia"]);
    });

    it("🔴 jeder Betrag trägt Zahl und Einheit getrennt: eine Darstellung für Zeilenwert, Unterzeile und Summe", () => {
        const result = lodgingOf({ inn: 8, open: 12, aboard: 0 }, "bett");
        // Die Stellen gelesen sind genau der Text: Zeilenwerte, Summe und Unterzeile teilen sich eine Darstellung.
        const spoken = (amount: { text: string; coins: Wert[] }) =>
            amount.coins.length === 0 ? amount.text : amount.coins.map(laufText).join(" ");
        for (const line of result.lines) expect(spoken(line.amount), line.key).toBe(line.value);
        expect(spoken(result.totalAmount)).toBe(result.total);
        for (const night of result.lines.find((line) => line.key === "lodging")?.nights ?? []) {
            if (night.amount) expect(spoken(night.amount)).toBe("4 S 8 H");
        }
        // Null Heller und „nicht ermittelbar“ haben keine Münze, nur ihren Text.
        expect(
            view(strasse, 52, DEFAULT_OPTIONS, borders(0)).lines.find((line) => line.key === "tolls")?.amount,
        ).toEqual({
            text: "—",
            coins: [],
        });
        expect(view(strasse, 52, DEFAULT_OPTIONS).lines.find((line) => line.key === "tolls")?.amount).toEqual({
            text: "?",
            coins: [],
        });
        // Mehrere Münzen: Zahl und Einheit je Stelle.
        expect(moneyCoins(1234)).toEqual([
            { zahl: "12", einheit: "D", abstand: " " },
            { zahl: "3", einheit: "S", abstand: " " },
            { zahl: "4", einheit: "H", abstand: " " },
        ]);
        expect(moneyCoins(0)).toEqual([]);
    });

    it("die Einzahl: „1 Landesgrenze“ (Legacy kennt nur die Mehrzahl)", () => {
        const line = view(strasse, 52, DEFAULT_OPTIONS, borders(1)).lines.find((entry) => entry.key === "tolls");
        expect(line).toMatchObject({ value: "1 D", note: "1 Landesgrenze, als Söldner veranlagt" });
    });

    it("🔴 0 Grenzen sind eine Antwort, kein Fehlen: „—“ und „0 Landesgrenzen …“ wie in Legacy, keine Liste", () => {
        const result = view(strasse, 52, DEFAULT_OPTIONS, borders(0));
        const line = result.lines.find((entry) => entry.key === "tolls");
        expect(line).toMatchObject({ value: "—", note: "0 Landesgrenzen, als Söldner veranlagt", unknown: false });
        expect(result.totalNote).toBe("2 Nächte, 3 Reisetage");
        expect(result.borders).toBeNull();
    });

    it("🔴 Z1 A+: ein Schiffsstück zwischen zwei Reichen sagt „Hafenzoll nicht beziffert“, ohne einen Betrag zu erfinden", () => {
        const plain = view(strasse, 52, DEFAULT_OPTIONS, borders(1, false));
        const harbour = view(strasse, 52, DEFAULT_OPTIONS, borders(1, true));
        expect(plain.lines.find((entry) => entry.key === "tolls")?.extra).toBeNull();
        const line = harbour.lines.find((entry) => entry.key === "tolls");
        expect(line?.extra).toBe("Hafenzoll nicht beziffert");
        expect(line?.value).toBe(plain.lines.find((entry) => entry.key === "tolls")?.value);
        // Auch bei 0 Grenzen (eine reine Seereise): der Hinweis steht, der Betrag bleibt „—“.
        const sea = view(strasse, 52, DEFAULT_OPTIONS, borders(0, true)).lines.find((entry) => entry.key === "tolls");
        expect(sea).toMatchObject({ value: "—", extra: "Hafenzoll nicht beziffert" });
    });

    it("die Liste der Übertritte: Kurznamen in Fahrtrichtung, die vollen Namen daneben; ohne Grenzen keine", () => {
        const list = view(strasse, 52, DEFAULT_OPTIONS, borders(2)).borders;
        expect(list?.count).toBe(2);
        expect(list?.steps).toEqual([
            {
                from: "R0",
                to: "R1",
                fromTitle: "Reich 0 vom Greifenthron",
                toTitle: "Reich 1 vom Greifenthron",
                x: 100,
                y: 50,
            },
            {
                from: "R1",
                to: "R2",
                fromTitle: "Reich 1 vom Greifenthron",
                toTitle: "Reich 2 vom Greifenthron",
                x: 101,
                y: 50,
            },
        ]);
    });

    it("🔴 englisch, nach Legacys Wortlaut: „national borders“, „assessed as …“, „Borders cannot be determined here“", () => {
        locale.value = "en";
        const line = (found: BorderCount | null, options = DEFAULT_OPTIONS) =>
            view(strasse, 52, options, found).lines.find((entry) => entry.key === "tolls");
        expect(line(borders(2))?.note).toBe("2 national borders, assessed as mercenaries");
        expect(line(borders(1))?.note).toBe("1 national border, assessed as mercenaries");
        expect(line(borders(2), withOptions({ lodging: "frei" }))?.note).toBe(
            "2 national borders, assessed as day labourers",
        );
        expect(line(borders(2), withOptions({ lodging: "strohsack" }))?.note).toBe(
            "2 national borders, assessed as journeymen",
        );
        expect(line(borders(2), withOptions({ lodging: "zimmer" }))?.note).toBe(
            "2 national borders, assessed as a well-paid profession",
        );
        expect(line(borders(1, true))?.extra).toBe("Harbour dues not quantified");
        expect(line(null)?.note).toBe("Borders cannot be determined here");
        expect(view(strasse, 52, DEFAULT_OPTIONS, null).totalNote).toBe("2 nights, 3 days of travel — excluding tolls");
        expect(view(strasse, 52, DEFAULT_OPTIONS, null).summary).toBe("3 S 6 H — excluding tolls");
        expect(view(strasse, 52, DEFAULT_OPTIONS, null).lines[0]?.nights?.[0]?.text).toBe("2 × in a shared room");
    });

    it("zu Pferd mit Reittier-Zeile; im Freien eigenes Futter", () => {
        const horse = [stage("Strasse", "groupHorse", 20, 20)];
        const stable = view(
            horse,
            52,
            withOptions({ transports: { ...DEFAULT_OPTIONS.transports, land: "groupHorse" } }),
        );
        // Der Stall kostet nur die Nächte im Gasthaus: dieselbe Zahl wie bei der Übernachtung, und das Wort sagt es.
        expect(stable.lines.find((line) => line.key === "mount")?.note).toBe(
            "2 × Stall mit Futter (Gasthausnächte), dazu Hufbeschlag",
        );
        expect(stable.totalNote).toBe("2 Nächte, 3 Reisetage, mit Reittier — ohne Zölle");
        expect(stable.summary).toBe(`${stable.total} — ohne Zölle`);
        expect(stable.borders).toBeNull();
        const outdoors = view(
            horse,
            52,
            withOptions({ lodging: "frei", transports: { ...DEFAULT_OPTIONS.transports, land: "groupHorse" } }),
        );
        expect(outdoors.lines.find((line) => line.key === "mount")?.note).toBe("eigenes Futter, dazu Hufbeschlag");
        expect(outdoors.lines.find((line) => line.key === "lodging")?.nights?.map((night) => night.text)).toEqual([
            "2 × im Freien",
        ]);
    });

    it("ein Tag ohne Nacht: „keine Nacht unterwegs“ und „1 Reisetag“", () => {
        const result = view([stage("Strasse", "groupFoot", 4, 4)], 4, DEFAULT_OPTIONS);
        expect(result.lines.find((line) => line.key === "lodging")?.nights?.map((night) => night.text)).toEqual([
            "keine Nacht unterwegs",
        ]);
        expect(result.lines.find((line) => line.key === "food")?.note).toBe("1 Reisetag");
    });

    it("Kutschfahrt und Seepassage mit ihren Meilen", () => {
        const coach = view(
            [stage("Strasse", "horseCarriage", 100, 40)],
            104,
            withOptions({ transports: { ...DEFAULT_OPTIONS.transports, land: "horseCarriage" } }),
        );
        expect(coach.lines.find((line) => line.key === "coach")).toMatchObject({ value: "12 D", note: "300,0 Meilen" });
        const sea = view([stage("Seeweg", "cargoShip", 200, 60)], 60, DEFAULT_OPTIONS);
        expect(sea.lines.find((line) => line.key === "sea")).toMatchObject({ label: "Seepassage", value: "4 D 2 H" });
    });
});
