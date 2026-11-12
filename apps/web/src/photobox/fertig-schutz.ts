/**
 * Der Schutz vor Verlust in der Bestätigung nach dem Einreichen (WI-0272, Entwurf 8; Betreiber 2026-11-01): Der persönliche Link ist der einzige Weg, das Bild später zu ändern, zurückzuziehen
 * oder offline zu nehmen; Avesmaps kennt ihn nicht (der Server speichert nur seine Prüfsumme). Wer das Fenster verlässt, ohne ihn kopiert oder gemerkt zu haben, verliert ihn.
 *
 * - **Diese Wege nehmen den Link aus dem Blick:** ✕, Esc und „Schließen“ (alle `zu`), „Noch ein Bild von hier“ (`noch-eins`) und „Stand ansehen“ (`stand`); von außen das Kartenmenü („Eigenes Bild hinzufügen“
 *   ersetzt die Bestätigung, `noch-eins`), „Meine Reisebilder“ (`meine`) und ein Fenster der Meldungen (`zu`). Ohne kopierten oder gemerkten Link hält der ERSTE dieser Versuche an: Im Fuß steht
 *   „Link noch nicht kopiert oder gemerkt.“ mit „Kopieren“ und „Trotzdem schließen“ (bei jedem anderen Weg „Trotzdem weiter“), der Linkkasten trägt einen Warnring und rollt in Sicht. Der Schutz hängt an der
 *   Steuerung (`reisebild-besucher.ts`, `schuetze`), nicht an den Knöpfen des Fensters: Auch ein Weg von außen fragt ihn zuerst (Review I1).
 * - **Der zweite Versuch geht durch**, welcher Weg es auch ist; nach dem Kopieren geht alles sofort. Gewarnt wird einmal, nie in einer Schleife.
 * - **Gemerkt zählt wie kopiert** (Entwurf 9, 2026-11-01): Wer „Auf diesem Gerät merken“ gesetzt hat, schließt ohne Warnung; setzt er das Häkchen erst nach der Warnung, verschwindet sie samt Warnring sofort.
 *   Ob gemerkt ist, steht NICHT im Schutz, sondern in der Merkliste (`meine-reisebilder.ts`): Der Aufrufer reicht es als `gemerkt` herein; dort entscheiden Speicher und Häkchen, nicht dieser Ablauf.
 * - **„Stand ansehen“ ist geschützt** (seit S3): Die Statusseite trägt zwar selbst den Linkkasten, ist aber nur noch über genau diesen Link erreichbar. Wer von der Bestätigung dorthin wechselt und sie
 *   mit ✕ schließt, hätte den Link sonst ungesichert aus dem Blick. (Die Probierseite schützt nur Schließen und „Noch ein Bild“.)
 * - Hält ein Weg von außen an, gilt er als nicht ausgeführt; das Fenster merkt ihn sich, und „Trotzdem weiter“ (oder „Kopieren“ in der Warnung) führt ihn aus. Wer ihn stattdessen noch einmal wählt, kommt
 *   ebenfalls durch.
 *
 * Reine Funktionen, damit Vitest den Ablauf ohne Browser prüft; die Oberfläche steht in `reisebild-fenster.vue` und `reisebild-fertig-fuss.vue`.
 */

/**
 * Was jemand mit dem Fenster vorhat: schließen (✕, Esc, „Schließen“, ein Fenster der Meldungen), ein neues Formular beginnen („Noch ein Bild von hier“, Kartenmenü „Eigenes Bild hinzufügen“), die
 * Statusseite öffnen („Stand ansehen“) oder die Liste „Meine Reisebilder“.
 */
export type WeiterArt = "zu" | "noch-eins" | "stand" | "meine";

export interface Schutz {
    /** Liegt der Link in der Zwischenablage (oder ist er sonst mitgenommen)? Dann geht alles ohne Halt. */
    readonly kopiert: boolean;
    /** Wurde schon einmal gewarnt, und wofür? Dann geht der zweite Versuch durch. */
    readonly gewarnt: WeiterArt | undefined;
}

export const frischerSchutz = (): Schutz => ({ kopiert: false, gewarnt: undefined });

/** Ein Weg, der den Link aus dem Blick nimmt: Hält er an (erster Versuch ohne kopierten oder gemerkten Link), oder geht er durch? */
export function pruefeWeiter(
    schutz: Schutz,
    weiter: WeiterArt,
    gemerkt = false,
): { readonly halt: boolean; readonly schutz: Schutz } {
    if (schutz.kopiert || gemerkt || schutz.gewarnt !== undefined) return { halt: false, schutz };
    return { halt: true, schutz: { ...schutz, gewarnt: weiter } };
}

/** Der Link ist kopiert: keine Warnung mehr, jeder Weg geht durch. */
export const nachKopieren = (): Schutz => ({ kopiert: true, gewarnt: undefined });

/** Der Link ist gemerkt: Eine Warnung, die schon stand, ist erledigt. Wird das Häkchen wieder genommen, hält der nächste Weg ohne kopierten Link wieder einmal an. */
export const nachMerken = (schutz: Schutz): Schutz => ({ ...schutz, gewarnt: undefined });

/** Steht gerade die Warnung da (im Fuß der Hinweis, am Linkkasten der Warnring)? Nie, solange der Link kopiert oder gemerkt ist. */
export const warnungSteht = (schutz: Schutz, gemerkt = false): boolean =>
    schutz.gewarnt !== undefined && !schutz.kopiert && !gemerkt;

/** Der Satz hinter dem leisen Knopf der Warnung: „Trotzdem schließen“ nur für das Schließen (und ohne Warnung), für jeden anderen Weg „Trotzdem weiter“. */
export const trotzdemSchluessel = (
    schutz: Schutz,
): "photobox.fertig.trotzdemSchliessen" | "photobox.fertig.trotzdemWeiter" =>
    schutz.gewarnt === undefined || schutz.gewarnt === "zu"
        ? "photobox.fertig.trotzdemSchliessen"
        : "photobox.fertig.trotzdemWeiter";
