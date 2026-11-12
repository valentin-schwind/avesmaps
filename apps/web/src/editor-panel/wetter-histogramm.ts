/**
 * Median und Mittel der Wetter-Histogramme unter Status › Statistik (WI-0288; Betreiber 2026-11-08: „kannst du beim nächsten push noch
 * median und mittelwert ins histogramm tun (farbig für die kategorien)“). Die Statistik kennt nur Klassen, keine Messwerte; beide
 * Kennzahlen sind darum aus den Klassen geschätzt:
 *
 * - **Median:** Die Klasse, in der die Hälfte der Zählung erreicht ist, linear in ihr aufgeteilt (wie bei gruppierten Daten üblich).
 * - **Mittel:** Jede Klasse mit ihrer Mitte gewichtet. Die offene oberste Klasse („120+“) bekommt die Breite ihrer Nachbarin, die
 *   unterste („<10“) beginnt bei 0; die Wolkenauflösung (auf 5 % gerundet) steht für ±2,5 % um ihren Wert.
 *
 * Die Lage ist die Stelle auf der Achse in Spalten (0 linker Rand der ersten, n rechter Rand der letzten), damit die Linie über der
 * richtigen Stelle des Balkens steht.
 */

/** Unter- und Obergrenze einer Klasse: `u10` [0, 10], `30-40` [30, 40], `ab120` [120, 120 + Breite davor], `2-3s` [2, 3], `25` [22,5, 27,5]. */
export function klassenGrenzen(klassen: readonly string[], i: number, punktklassen = false): [number, number] {
    const klasse = klassen[i]!.replace(/s$/u, "");
    if (punktklassen) {
        const wert = Number(klasse);
        return [wert - 2.5, wert + 2.5];
    }
    const unter = /^u(\d+)$/u.exec(klasse);
    if (unter !== null) return [0, Number(unter[1])];
    const offen = /^ab(\d+)$/u.exec(klasse);
    if (offen !== null) {
        const von = Number(offen[1]);
        const davor: [number, number] = i > 0 ? klassenGrenzen(klassen, i - 1) : [0, von];
        return [von, von + (davor[1] - davor[0])];
    }
    const spanne = /^(\d+)-(\d+)$/u.exec(klasse);
    if (spanne !== null) return [Number(spanne[1]), Number(spanne[2])];
    return [Number.NaN, Number.NaN];
}

export interface Kennzahl {
    /** Der geschätzte Wert in der Einheit der Klassen. */
    wert: number;
    /** Die Stelle auf der Achse in Spalten (0 bis Zahl der Klassen). */
    lage: number;
}

/** Median und Mittel einer Zählung je Klasse; `undefined` ohne Zählung. */
export function medianUndMittel(
    klassen: readonly string[],
    zahlen: readonly number[],
    punktklassen = false,
): { median: Kennzahl; mittel: Kennzahl } | undefined {
    const summe = zahlen.reduce((a, b) => a + b, 0);
    if (summe <= 0) return undefined;
    const grenzen = klassen.map((_, i) => klassenGrenzen(klassen, i, punktklassen));
    // Median: die Klasse, in der die Hälfte erreicht ist, darin linear.
    let kumuliert = 0;
    let median: Kennzahl = { wert: grenzen[0]![0], lage: 0 };
    for (let i = 0; i < zahlen.length; i++) {
        const zahl = zahlen[i]!;
        if (zahl > 0 && kumuliert + zahl >= summe / 2) {
            const anteil = (summe / 2 - kumuliert) / zahl;
            const [von, bis] = grenzen[i]!;
            median = { wert: von + anteil * (bis - von), lage: i + anteil };
            break;
        }
        kumuliert += zahl;
    }
    // Mittel: jede Klasse mit ihrer Mitte gewichtet; die Lage ist die Stelle dieses Werts auf der Achse.
    const wert = zahlen.reduce((s, zahl, i) => s + zahl * ((grenzen[i]![0] + grenzen[i]![1]) / 2), 0) / summe;
    return { median, mittel: { wert, lage: lageVon(grenzen, wert) } };
}

/** Die Stelle eines Werts auf der Achse: in der Klasse, die ihn enthält, linear; außerhalb an den Rand geklemmt. */
function lageVon(grenzen: readonly [number, number][], wert: number): number {
    for (let i = 0; i < grenzen.length; i++) {
        const [von, bis] = grenzen[i]!;
        if (wert < bis || i === grenzen.length - 1)
            return Math.min(grenzen.length, i + Math.max(0, (wert - von) / (bis - von)));
    }
    return grenzen.length;
}
