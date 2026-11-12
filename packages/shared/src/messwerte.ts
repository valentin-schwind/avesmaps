import { Type, type Static } from "@sinclair/typebox";

/**
 * Die Messwerte des Betriebs für das Messfenster (WI-0138 V15; Betreiber 2026-10-13: „ein frei verschiebares panel mit Server
 * CPU, RAM, Client CPU, RAM, FPS, Nutzer (online), Editoren (online)").
 *
 *     GET /api/messwerte    Last dieser Instanz und wer gerade da ist    use_editor_menu
 *
 * 🔴 **Nur die eigene Instanz, nur Zahlen.** Keine Pfade, keine Prozessliste, keine Umgebung — was hier steht, verrät nichts
 * über den Rechner außer seiner Auslastung. Die Werte des Clients misst der Browser selbst und schickt sie nirgendwohin.
 */

export const MESSWERTE_URL = "/api/messwerte";

export const Messwerte = Type.Object(
    {
        server: Type.Object(
            {
                /** Anteil einer Kernzeit, den dieser Prozess seit der letzten Frage verbraucht hat (0 bis 1 je Kern). */
                cpu: Type.Union([Type.Number(), Type.Null()]),
                /** Hauptspeicher dieses Prozesses in Byte (RSS). */
                rss: Type.Integer(),
                /** Hauptspeicher der Maschine: belegt und gesamt, in Byte. */
                ramBelegt: Type.Integer(),
                ramGesamt: Type.Integer(),
                /** Mittlere Last der Maschine über eine Minute, geteilt durch die Zahl der Kerne; unter Windows `null`. */
                last: Type.Union([Type.Number(), Type.Null()]),
                kerne: Type.Integer(),
                /** Sekunden seit dem Start dieses Prozesses. */
                laeuftSeit: Type.Integer(),
            },
            { additionalProperties: false },
        ),
        jetzt: Type.Object(
            {
                besucher: Type.Integer(),
                editoren: Type.Integer(),
                fensterMinuten: Type.Integer(),
            },
            { additionalProperties: false },
        ),
    },
    { additionalProperties: false },
);
export type Messwerte = Static<typeof Messwerte>;

/** Wie oft das Fenster nachfragt. Zwei Sekunden sind oft genug für „jetzt" und selten genug für eine Lesekarte. */
export const MESSWERTE_TAKT_MS = 2000;

/**
 * Der Verlauf der Serverlast (WI-0141, Unterreiter „Server“):
 *
 *     GET /api/messwerte/verlauf    24 h, Wochentafel und Tage    use_editor_menu
 *
 * Die **letzte Minute** steht hier nicht: Die hält der Browser selbst aus seinen eigenen Abfragen (alle zwei Sekunden,
 * dreißig Punkte). Eine Sekundenreihe zu speichern, wäre Messung um der Messung willen.
 */
export const MESSWERTE_VERLAUF_URL = "/api/messwerte/verlauf";

const Zahl = Type.Union([Type.Number(), Type.Null()]);

export const MesswerteVerlauf = Type.Object(
    {
        /** 24 h in Fächern von fünf Minuten, ältestes zuerst; `cpu` und `last` sind Anteile 0 bis 1. */
        tag: Type.Array(
            Type.Object(
                { zeit: Type.String(), cpu: Zahl, last: Zahl, ramBelegt: Zahl, ramGesamt: Zahl },
                { additionalProperties: false },
            ),
        ),
        /** Die Tage als Mittel und Spitze, ältester zuerst; die Spitze ist der höchste Stundenwert des Tages. */
        tage: Type.Array(
            Type.Object(
                { tag: Type.String(), cpu: Zahl, cpuSpitze: Zahl, ram: Zahl, ramSpitze: Zahl },
                { additionalProperties: false },
            ),
        ),
        /** Wochentag (0 = Montag) × Stunde, der Mittelwert der CPU-Last; `null`, wo nie gemessen wurde. */
        tafel: Type.Array(Type.Array(Zahl)),
        /** Woher die Zahlen kommen: wie viele Stunden verdichtet vorliegen. */
        stunden: Type.Integer(),
    },
    { additionalProperties: false },
);
export type MesswerteVerlauf = Static<typeof MesswerteVerlauf>;
