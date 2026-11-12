/**
 * Kammlinien für den Rückfall des Rückennetzes (WI-0246): die Leitkurve aus Legacy (`V12Input.kurve`) ohne Umkehr. Herkunft: die
 * Faltung (WI-0242, zurückgebaut 2026-10-20), die dieselbe Teilung brauchte.
 */
export type Linie = readonly (readonly number[])[];

/** Knickwinkel, ab dem eine Kammlinie als umkehrend gilt (Grad). */
const UMKEHR_GRAD = 120;

/**
 * 🔴 Kammlinien ohne Umkehr: Eine gezeichnete Kurve kann an einem Punkt kehrtmachen und über sich zurücklaufen (die Rote Sichel läuft
 * nach Süden, kehrt um, nach Norden bis 714 und wieder zurück über dieselbe Strecke). Dort wechselt das Vorzeichen von s von Zelle zu
 * Zelle, und die Faltenlinien zerfallen in Kästen (2026-10-20). Die Linie wird an jeder Umkehr geteilt; ein Stück, das zur Hälfte auf
 * einem längeren liegt (näher als 0,5 E), fällt weg.
 */
export function kammOhneUmkehr(linien: readonly Linie[]): Linie[] {
    const stuecke: (readonly number[])[][] = [];
    for (const linie of linien) {
        let stueck: (readonly number[])[] = [];
        for (let i = 0; i < linie.length; i++) {
            const p = linie[i] as readonly number[];
            const vorher = stueck[stueck.length - 1];
            if (vorher && Math.hypot(p[0]! - vorher[0]!, p[1]! - vorher[1]!) <= 0) continue;
            const davor = stueck[stueck.length - 2];
            if (vorher && davor) {
                const ax = vorher[0]! - davor[0]!;
                const ay = vorher[1]! - davor[1]!;
                const bx = p[0]! - vorher[0]!;
                const by = p[1]! - vorher[1]!;
                const cos = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by));
                if (cos < Math.cos((UMKEHR_GRAD * Math.PI) / 180)) {
                    stuecke.push(stueck);
                    stueck = [vorher];
                }
            }
            stueck.push(p);
        }
        if (stueck.length >= 2) stuecke.push(stueck);
    }
    const laenge = (st: readonly (readonly number[])[]): number =>
        st.slice(1).reduce((summe, p, i) => summe + Math.hypot(p[0]! - st[i]![0]!, p[1]! - st[i]![1]!), 0);
    const abstand = (x: number, y: number, st: readonly (readonly number[])[]): number => {
        let best = Infinity;
        for (let i = 1; i < st.length; i++) {
            const [ax, ay] = st[i - 1] as [number, number];
            const [bx, by] = st[i] as [number, number];
            const dx = bx - ax;
            const dy = by - ay;
            const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
            best = Math.min(best, Math.hypot(x - ax - u * dx, y - ay - u * dy));
        }
        return best;
    };
    const behalten: Linie[] = [];
    for (const st of stuecke.sort((a, b) => laenge(b) - laenge(a))) {
        const darauf = st.filter((p) => behalten.some((b) => abstand(p[0]!, p[1]!, b) < 0.5)).length;
        if (darauf * 2 < st.length) behalten.push(st);
    }
    return behalten;
}
