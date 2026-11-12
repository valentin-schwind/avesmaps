/**
 * Der Avatar: Anfangsbuchstabe auf einer Fläche, deren Ton aus der KENNUNG der Person folgt (WI-0120 A8, AUTH-0001 §3
 * „Avatar-Farbe aus der UUID“).
 *
 * 🔴 Nie aus dem Namen. Ein Name ist Anzeige: Er ändert sich, zwei Personen können gleich heißen, und eine Farbe, die am
 * Namen hängt, wechselte mit jeder Umbenennung (Mockup: Tabelle je Name, Befund M12 der Discovery). Die Kennung bleibt.
 * Ein echtes Bild (Discord-Avatar) wäre eine Anfrage an einen fremden Dienst und gehört in den Datenschutz-Nachtrag,
 * nicht hierher.
 *
 * Die Töne sind Paare aus dem Kanon (Fläche und Schrift), die in BEIDEN Themen lesen: Schrift gegen Fläche mindestens
 * 4,5 : 1, hell wie dunkel (gemessen am 2026-10-09 mit den Werten aus `config/design-canon/avesmaps.json`). Alle warm,
 * keins blau (Guide P2), keins mit einer Statusbedeutung (Erfolg, Gefahr, Kanon, Verborgen). Die Paare stehen in
 * `avm-avatar.vue`, je Ton eine Regel; hier steht nur, wie viele es sind und wie eine Kennung einen davon wählt.
 */

/** So viele Töne kennt der Avatar; `avm-avatar.vue` trägt für jeden genau eine Regel `[data-ton="<i>"]`. */
export const AVATAR_TOENE = 7;

/**
 * Der Ton einer Kennung: FNV-1a (32 bit) über die Zeichen, dann der Rest. Gleiche Kennung, gleicher Ton - in jedem
 * Browser, in jeder Sitzung, ohne Tabelle. Groß- und Kleinschreibung zählen nicht, eine UUID kommt in beiden Formen vor.
 */
export function avatarTon(kennung: string): number {
    let hash = 0x811c9dc5;
    for (const zeichen of kennung.trim().toLowerCase()) {
        hash ^= zeichen.codePointAt(0) ?? 0;
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash % AVATAR_TOENE;
}

/**
 * Der Anfangsbuchstabe eines Anzeigenamens: das erste Zeichen, das ein Buchstabe oder eine Ziffer ist, groß geschrieben.
 * Satzzeichen vorn („_Rondra“, „.Alrike“) zählen nicht. Ohne Buchstaben bleibt „?“ - lieber ein Fragezeichen als ein Strich.
 */
export function avatarInitiale(name: string): string {
    const erstes = /[\p{L}\p{N}]/u.exec(name.normalize("NFC"))?.[0];
    return erstes === undefined ? "?" : erstes.toLocaleUpperCase("de");
}
