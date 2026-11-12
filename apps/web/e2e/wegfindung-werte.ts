import {
    MEILEN_JE_EINHEIT,
    WEGFINDUNG_FOLGE_SATZ,
    WEGFINDUNG_PANELE,
    wegfindungVorgabe,
    type WegfindungFolge,
    type WegfindungWert,
} from "@avesmaps3d/shared";

/**
 * Was das Mockup „Wegfindung“ (WI-0153) über die Tafel hinaus braucht: die Formatierung der Zahlen und die zwei
 * Zustände, die das Blatt zeigen soll.
 *
 * 🔴 **Die Werte selbst stehen nicht mehr hier.** Sie sind die Tafel im geteilten Paket
 * (`packages/shared/src/wegfindung.ts`), gegen den Code geprüft von `apps/server/test/wegfindung-vorgaben.test.ts`.
 * Eine zweite Liste im Mockup wäre eine zweite Wahrheit, und sie wäre die, die zuerst veraltet.
 */

export { MEILEN_JE_EINHEIT as MEILEN };

export const zahl = (wert: number): string => wert.toLocaleString("de-DE", { maximumFractionDigits: 6 });
const meilen = (wert: number): string => `${zahl(Number((wert * MEILEN_JE_EINHEIT).toPrecision(6)))} Meilen`;

/**
 * Die zwei Zustände, die das Blatt zeigt (Betreiber 2026-10-15): EINE Zeile steht geändert und noch nicht gerechnet
 * da, und EIN Wert mit Herkunft weicht von ihr ab. Beides gehört zum Bild, nicht zur Tafel.
 */
const GEAENDERT: Readonly<Record<string, number>> = { endSnap: 0.03 };
const ABWEICHEND: Readonly<Record<string, number>> = { querfeldeinAufschlag: 30 };

/** Was aus dem Modul in die Seite reist: fertige Zeichenketten, keine Rechnung im Browser. */
export interface WertGabe {
    name: string;
    satz: string;
    /** Die Kennung der Folge, für den Ton der Zeile. */
    folge: WegfindungFolge;
    /** Was eine Änderung nach sich zieht, als Satz. */
    folgeSatz: string;
    /** Der geltende Wert, wie er dasteht. */
    wert: string;
    /** Die Entsprechung in Meilen oder die Einheit, hinter dem Feld. */
    neben: string;
    /** Der eingetragene neue Wert und seine Meilen; fehlt, wenn die Zeile nicht geändert ist. */
    neu?: string;
    nebenNeu?: string;
    /** Die Herkunft als fertiger Satz; fehlt, wenn der Wert keine hat. */
    herkunft?: string;
    /** Der abweichend eingestellte Wert. */
    abweichend?: string;
    abschnitt?: string;
}
export interface PanelGabe {
    titel: string;
    wirkung: string;
    werte: WertGabe[];
}

const neben = (wert: WegfindungWert): string =>
    wert.einheiten === undefined ? (wert.einheit ?? "") : `(${meilen(wert.einheiten)})`;

export const gabe = (): PanelGabe[] =>
    WEGFINDUNG_PANELE.map((panel) => ({
        titel: panel.titel,
        wirkung: panel.wirkung,
        werte: panel.werte.map<WertGabe>((wert) => {
            const geaendert = GEAENDERT[wert.id];
            const abweichend = ABWEICHEND[wert.id];
            return {
                name: wert.name,
                satz: wert.satz,
                folge: wert.folge,
                folgeSatz: WEGFINDUNG_FOLGE_SATZ[wert.folge],
                wert: wert.text ?? zahl(wert.einheiten ?? 0),
                neben: neben(wert),
                ...(wert.abschnitt === undefined ? {} : { abschnitt: wert.abschnitt }),
                ...(geaendert === undefined ? {} : { neu: zahl(geaendert), nebenNeu: `(${meilen(geaendert)})` }),
                ...(wert.herkunft === undefined
                    ? {}
                    : {
                          herkunft:
                              `Herkunft: ${zahl(wegfindungVorgabe(wert))} · ${wert.herkunft.satz} · ` +
                              `config/travel-model/aventuria.json, Feld „${wert.herkunft.feld}“`,
                      }),
                ...(abweichend === undefined ? {} : { abweichend: zahl(abweichend) }),
            };
        }),
    }));

/** Datei und Name jedes gezeigten Werts, für die Quellenzeile des Blattes. */
export const QUELLEN: readonly string[] = WEGFINDUNG_PANELE.flatMap((panel) => panel.werte.map((wert) => wert.quelle));

/** Die Tafel selbst, für die Wächter des Blattes. */
export const PANELE = WEGFINDUNG_PANELE;
