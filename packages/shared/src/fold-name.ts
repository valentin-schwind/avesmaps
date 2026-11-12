/**
 * Wie ein Ortsname verglichen wird, wenn es nicht auf die Schreibweise ankommt: klein, ohne Akzente,
 * ß als ss (WI-0017, Wegpunktsuche). „Garen" findet „Garèn", „Strasse" findet „Straße".
 *
 * ⭐ EINE Stelle für Server und Oberfläche - sonst fände das Feld einen Ort, den der Server nicht
 * kennt, oder umgekehrt.
 */
export function foldName(name: string): string {
    return name.normalize("NFD").replace(/\p{M}/gu, "").replace(/ß/g, "ss").toLowerCase().trim();
}
