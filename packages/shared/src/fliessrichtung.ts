/**
 * Die Fließrichtung „dem Lauf nach“ (OPS-000112, Mockup Flussumbau; Vali 2026-11-11 „A: in alle Arme“, 2026-11-12 „ja, bauen“): Der
 * Knopf „Auf alle Abschnitte übernehmen“ gibt die Richtung EINES Abschnitts den anderen Abschnitten desselben Flusses, je Abschnitt in seine
 * eigene Zeichenrichtung umgerechnet. Den gespeicherten Wert zu kopieren drehte am Mhanadi 27 Pfeile gegen den Strom.
 *
 * Rein, ohne Datenbank. Die Knoten liefert der Server mit der Topologie der Wegfindung (`GET …/street/flussnetz`, `path-flussnetz.ts`):
 * Zwei Enden sind ein Knoten, wenn die Wegfindung sie verbindet (Ort im Kasten, Ende auf Ende im Fangradius, T-Stoß). Ein Abschnitt hat seine
 * Knoten in Zeichenrichtung, dazu die inneren Teilungen (ein Ort auf der Linie, ein anderer Abschnitt, der dort endet).
 *
 * - **Flussabwärts in alle Arme:** Jeder Knoten liegt auf der Seite der Mündung oder der Quelle des Startabschnitts, je nachdem, welches seiner
 *   Enden über den Fluss (ohne den Startabschnitt) näher ist. Auf der Seite der Mündung fließt das Wasser vom näheren zum ferneren Knoten, also
 *   in jeden Arm eines Deltas und um jede Insel herum. Ein Abschnitt zwischen beiden Seiten fließt von der Quelle zur Mündung.
 * - **Flussaufwärts bis zur Gabelung:** Von der Quelle des Startabschnitts die Kette hinauf, solange je Knoten nur ein Abschnitt Wasser bringen
 *   kann. Eine Insel (zwei Arme, die sich weiter oben wieder treffen) nimmt sie mit; an jeder anderen Gabelung hält sie.
 * - **Nicht erreicht** bleiben Abschnitte hinter einer Lücke (`unterbrochen`, sie hängen nicht am Startabschnitt) und hinter einer Gabelung
 *   flussaufwärts (`gabelung`). Sie behalten ihre Richtung.
 */

export type Fliessrichtung = "forward" | "reverse";

/** Ein Abschnitt im Flussnetz: seine Knoten in Zeichenrichtung (mindestens zwei) und die Länge zwischen je zwei Knoten. */
export interface FlussAbschnitt {
    readonly id: string;
    readonly knoten: readonly string[];
    readonly laengen: readonly number[];
}

export interface FliessrichtungsLauf {
    /** Die neue Richtung je erreichtem Abschnitt, der Startabschnitt eingeschlossen. */
    readonly neu: Readonly<Record<string, Fliessrichtung>>;
    /** Nicht erreicht, weil der Fluss dazwischen unterbrochen ist. */
    readonly unterbrochen: readonly string[];
    /** Nicht erreicht, weil der Fluss sich flussaufwärts teilt. */
    readonly gabelung: readonly string[];
}

/** Ein Stück zwischen zwei Knoten eines Abschnitts (`a` ist sein Index). Es fließt in Zeichenrichtung von `von` nach `bis`. */
interface Stueck {
    readonly a: number;
    readonly von: string;
    readonly bis: string;
    readonly laenge: number;
}

interface Netz {
    readonly stuecke: readonly Stueck[];
    /** Je Knoten die Stücke, die ihn berühren. */
    readonly an: ReadonlyMap<string, readonly number[]>;
}

function netzAus(abschnitte: readonly FlussAbschnitt[]): Netz {
    const stuecke: Stueck[] = [];
    const an = new Map<string, number[]>();
    abschnitte.forEach((abschnitt, a) => {
        for (let j = 0; j + 1 < abschnitt.knoten.length; j++) {
            const von = abschnitt.knoten[j]!;
            const bis = abschnitt.knoten[j + 1]!;
            // Zwei gleiche Knoten hintereinander (eine Teilung genau am Ende) sind kein Stück.
            if (von === bis) continue;
            const s = stuecke.push({ a, von, bis, laenge: abschnitt.laengen[j] ?? 0 }) - 1;
            for (const k of [von, bis]) an.set(k, [...(an.get(k) ?? []), s]);
        }
    });
    return { stuecke, an };
}

const anfang = (abschnitt: FlussAbschnitt): string => abschnitt.knoten[0]!;
const ende = (abschnitt: FlussAbschnitt): string => abschnitt.knoten[abschnitt.knoten.length - 1]!;
/** Wo das Wasser in den Abschnitt hinein- und wo es hinausläuft. */
const reinIn = (abschnitt: FlussAbschnitt, r: Fliessrichtung): string =>
    r === "forward" ? anfang(abschnitt) : ende(abschnitt);
const rausAus = (abschnitt: FlussAbschnitt, r: Fliessrichtung): string =>
    r === "forward" ? ende(abschnitt) : anfang(abschnitt);
/** Die Richtung, in der das Wasser im Stück auf den Knoten `v` zuläuft. */
const zu = (stueck: Stueck, v: string): Fliessrichtung => (stueck.bis === v ? "forward" : "reverse");
const andererKnoten = (stueck: Stueck, v: string): string => (stueck.von === v ? stueck.bis : stueck.von);

/** Wegstrecken über den Fluss ab Knoten `von`, ohne die Stücke des Abschnitts `ohne` (Dijkstra). */
function abstaende(netz: Netz, von: string, ohne: number): Map<string, number> {
    const d = new Map<string, number>([[von, 0]]);
    const offen = new Set([von]);
    while (offen.size > 0) {
        let v = "";
        for (const k of offen) if (v === "" || d.get(k)! < d.get(v)!) v = k;
        offen.delete(v);
        for (const s of netz.an.get(v) ?? []) {
            const stueck = netz.stuecke[s]!;
            if (stueck.a === ohne) continue;
            const w = andererKnoten(stueck, v);
            const weit = d.get(v)! + stueck.laenge;
            if (weit < (d.get(w) ?? Infinity)) {
                d.set(w, weit);
                offen.add(w);
            }
        }
    }
    return d;
}

/** Vom Knoten `v` über das Stück `s` weiter, solange je Knoten nur zwei Stücke liegen: die Kette und ihr Endknoten (`""` im Ring). */
function kette(netz: Netz, v: string, s: number): { glieder: { s: number; von: string }[]; ende: string } {
    const glieder: { s: number; von: string }[] = [];
    const gesehen = new Set<number>();
    let jetzt = s;
    let von = v;
    for (;;) {
        if (gesehen.has(jetzt)) return { glieder, ende: "" };
        gesehen.add(jetzt);
        glieder.push({ s: jetzt, von });
        const weiter = andererKnoten(netz.stuecke[jetzt]!, von);
        const rest = (netz.an.get(weiter) ?? []).filter((k) => k !== jetzt);
        if (rest.length !== 1) return { glieder, ende: weiter };
        von = weiter;
        jetzt = rest[0]!;
    }
}

/** Die Richtung des Abschnitts `start` dem Lauf nach an die anderen Abschnitte (siehe oben). */
export function fliessrichtungDemLaufNach(
    abschnitte: readonly FlussAbschnitt[],
    start: string,
    richtung: Fliessrichtung,
): FliessrichtungsLauf {
    const s0 = abschnitte.findIndex((a) => a.id === start);
    if (s0 < 0) return { neu: {}, unterbrochen: [], gabelung: [] };
    const netz = netzAus(abschnitte);
    const neu: (Fliessrichtung | undefined)[] = abschnitte.map(() => undefined);
    neu[s0] = richtung;
    const startAbschnitt = abschnitte[s0]!;

    // Flussabwärts in alle Arme: die Seite je Knoten nach der Wegstrecke zur Mündung und zur Quelle des Startabschnitts.
    const unten = abstaende(netz, rausAus(startAbschnitt, richtung), s0);
    const oben = abstaende(netz, reinIn(startAbschnitt, richtung), s0);
    const seite = (k: string): "unten" | "oben" | "" => {
        const u = unten.get(k) ?? Infinity;
        const o = oben.get(k) ?? Infinity;
        return u < o ? "unten" : o < u ? "oben" : "";
    };
    abschnitte.forEach((abschnitt, a) => {
        if (a === s0 || abschnitt.knoten.length < 2) return;
        const [ka, kb] = [anfang(abschnitt), ende(abschnitt)];
        if (ka === kb) return;
        const [sa, sb] = [seite(ka), seite(kb)];
        if (sa === "unten" && sb === "unten") {
            const [ua, ub] = [unten.get(ka)!, unten.get(kb)!];
            if (ua !== ub) neu[a] = ua < ub ? "forward" : "reverse";
        } else if (sa === "oben" && sb === "unten") neu[a] = "forward";
        else if (sa === "unten" && sb === "oben") neu[a] = "reverse";
    });

    // Flussaufwärts: Am Knoten v läuft das Wasser hinaus (in die Abschnitte `raus`); die übrigen, noch offenen bringen es heran.
    const offeneStuecke = (v: string, raus: ReadonlySet<number>): number[] =>
        (netz.an.get(v) ?? []).filter((s) => !raus.has(netz.stuecke[s]!.a) && neu[netz.stuecke[s]!.a] === undefined);
    /** Hängt an einem inneren Knoten des Abschnitts noch etwas Offenes, teilt sich der Fluss dort: nicht weiter hinauf. */
    const innenGeteilt = (a: number): boolean =>
        abschnitte[a]!.knoten.slice(1, -1).some((k) => offeneStuecke(k, new Set([a])).length > 0);
    let v = reinIn(startAbschnitt, richtung);
    let raus = new Set([s0]);
    if (innenGeteilt(s0)) v = "";
    for (let schritt = 0; v !== "" && schritt < 100000; schritt++) {
        const andere = offeneStuecke(v, raus);
        if (andere.length === 0) break;
        if (andere.length === 1) {
            const stueck = netz.stuecke[andere[0]!]!;
            neu[stueck.a] = zu(stueck, v);
            raus = new Set([stueck.a]);
            v = innenGeteilt(stueck.a) ? "" : reinIn(abschnitte[stueck.a]!, neu[stueck.a]!);
            continue;
        }
        // Eine Insel: genau zwei Arme, die sich weiter oben im selben Knoten treffen und noch offen sind.
        if (andere.length === 2) {
            const k1 = kette(netz, v, andere[0]!);
            const k2 = kette(netz, v, andere[1]!);
            const glieder = [...k1.glieder, ...k2.glieder];
            if (
                k1.ende !== "" &&
                k1.ende === k2.ende &&
                k1.ende !== v &&
                glieder.every((g) => neu[netz.stuecke[g.s]!.a] === undefined)
            ) {
                // Die Kette läuft von v weg, das Wasser kommt aber von oben: also gegen die Kette.
                for (const g of glieder) neu[netz.stuecke[g.s]!.a] = zu(netz.stuecke[g.s]!, g.von);
                raus = new Set([k1, k2].map((k) => netz.stuecke[k.glieder.at(-1)!.s]!.a));
                v = k1.ende;
                continue;
            }
        }
        break;
    }

    // Nicht erreicht: hinter einer Lücke, wenn kein Weg über den Fluss zum Startabschnitt führt, sonst hinter einer Gabelung.
    const verbunden = new Set<number>([s0]);
    const knotenOffen = [...startAbschnitt.knoten];
    const besucht = new Set<string>(knotenOffen);
    while (knotenOffen.length > 0) {
        const k = knotenOffen.pop()!;
        for (const s of netz.an.get(k) ?? []) {
            const stueck = netz.stuecke[s]!;
            verbunden.add(stueck.a);
            for (const w of [stueck.von, stueck.bis])
                if (!besucht.has(w)) {
                    besucht.add(w);
                    knotenOffen.push(w);
                }
        }
    }
    const ergebnis: Record<string, Fliessrichtung> = {};
    const unterbrochen: string[] = [];
    const gabelung: string[] = [];
    abschnitte.forEach((abschnitt, a) => {
        const r = neu[a];
        if (r !== undefined) ergebnis[abschnitt.id] = r;
        else if (verbunden.has(a)) gabelung.push(abschnitt.id);
        else unterbrochen.push(abschnitt.id);
    });
    return { neu: ergebnis, unterbrochen, gabelung };
}

/**
 * Wo zeigen die Pfeile gegeneinander? An einem Knoten, an dem genau zwei Abschnitte enden (sonst nichts), fließen beide hinein oder beide
 * hinaus. Je Stelle das Paar in der Folge der Abschnitte; offene Abschnitte zählen nicht.
 */
export function fliessrichtungGegeneinander(
    abschnitte: readonly FlussAbschnitt[],
    richtung: Readonly<Record<string, Fliessrichtung | null | undefined>>,
): [string, string][] {
    const netz = netzAus(abschnitte);
    const paare: [string, string][] = [];
    for (const [v, liste] of netz.an) {
        if (liste.length !== 2) continue;
        const [x, y] = liste.map((s) => netz.stuecke[s]!);
        if (x === undefined || y === undefined || x.a === y.a) continue;
        const rx = richtung[abschnitte[x.a]!.id];
        const ry = richtung[abschnitte[y.a]!.id];
        if (!rx || !ry) continue;
        const xRein = zu(x, v) === rx;
        const yRein = zu(y, v) === ry;
        if (xRein === yRein)
            paare.push(
                x.a < y.a ? [abschnitte[x.a]!.id, abschnitte[y.a]!.id] : [abschnitte[y.a]!.id, abschnitte[x.a]!.id],
            );
    }
    return paare.sort(
        (p, q) => abschnitte.findIndex((a) => a.id === p[0]) - abschnitte.findIndex((a) => a.id === q[0]),
    );
}
