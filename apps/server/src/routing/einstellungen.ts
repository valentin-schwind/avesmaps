import { WEGFINDUNG_ALS_ANTEIL, wegfindungVorgaben, type TravelModel, type Wegfindungswerte } from "@avesmaps3d/shared";

/**
 * Die wirksamen Kenngrößen der Wegfindung im Routing (WI-0153 Schnitt 5): die 51 Zahlen, mit denen dieser Prozess
 * gerade rechnet. Die Vorgaben stehen im Register (`packages/shared/src/wegfindung.ts`), die Abweichungen in
 * `routing_setting` (Migration 0132); `system/wegfindung.ts` liest sie, `service.ts` setzt sie.
 *
 * 🔴 **Ohne gesetzten Wert ändert sich NICHTS.** Ist die Tafel leer, stehen hier die Vorgaben, und die sind dieselben
 * Zahlen, die vorher als Konstanten im Quelltext standen (geprüft: `wegfindung-vorgaben.test.ts` rechnet jede gegen
 * ihre Konstante nach, und der Topologievergleich über 206 Routen liefert Zeile für Zeile dieselben Meilen,
 * Stunden und Kehren).
 *
 * 🪤 **Nicht in der heißen Schleife nachschlagen.** `werte()` ist ein Zeiger auf ein eingefrorenes Objekt, kein
 * Nachschlagen in der Datenbank — aber wer es je Kante ruft, zahlt trotzdem. Die Regel ist: EINMAL am Anfang einer
 * Suche oder eines Aufbaus in eine lokale Konstante lesen, dann durchreichen. Dieselbe Regel gilt im Register: Die
 * Konstanten bleiben stehen und sind weiterhin die Vorgabe, nur ihr Lesen wandert.
 *
 * 🔴 **Ein Stand ist ein Schnappschuss** (`service.ts`): Umgestellt wird erst, wenn der neue Datenstand gilt, nie
 * während er lädt. Was in den Netzaufbau geht, reicht `service.ts` dem Loader als Argument mit (wie `endSnap` seit
 * WI-0147) — sonst baute der neue Stand mit neuen Werten, während der alte mit denselben Werten antwortet.
 */

/** Die Vorgaben aus dem Register, eingefroren: der Stand ohne jede Abweichung. */
export const WEGFINDUNG_VORGABEN: Wegfindungswerte = Object.freeze(wegfindungVorgaben());

let aktiv: Wegfindungswerte = WEGFINDUNG_VORGABEN;

/** Die Zahlen, mit denen dieser Prozess gerade rechnet. */
export const werte = (): Wegfindungswerte => aktiv;

/**
 * Einer der vier Werte, die das Register in Prozent führt, als Anteil: `weighDetour` steht dort als 50 und kommt
 * hier als 0,5 heraus — die Zahl, die im Code steht. 🪤 Wer ihn ohne diese Schleuse liest, rechnet hundertfach.
 */
export function anteil(id: (typeof WEGFINDUNG_ALS_ANTEIL)[number]): number {
    return aktiv[id] / 100;
}

/**
 * Setzt die wirksamen Zahlen (der Worker beim Wechsel des Datenstands, ein Werkzeug beim Start). `null` stellt die
 * Vorgaben her — das ist auch der Zustand jedes Prozesses, der nie etwas setzt: Kommandozeile, Tests, Ableitungen.
 */
export function setzeWerte(neu: Wegfindungswerte | null): void {
    aktiv = neu ?? WEGFINDUNG_VORGABEN;
}

/**
 * Die Kenngrößen des Netzaufbaus aus einem Satz wirksamer Werte, in der Form von `NetworkOptions` (`network.ts`):
 * Fangradius, Ortskasten, exakter Treffer, Schritt je Karteneinheit. 🔴 EINE Hilfe für Router, Wegeditor und Prüfhaken
 * (WI-0214, Befund S3-02): Vorher baute jeder die Topologie mit eigenen Zahlen, die Prüfhaken mit den Vorgaben.
 */
export function netzOptionen(werte: Wegfindungswerte): {
    endSnap: number;
    endpointBox: number;
    exactHit: number;
    schrittPerUnit: number;
} {
    return {
        endSnap: werte.endSnap,
        endpointBox: werte.endpointBox,
        exactHit: werte.exactHit,
        schrittPerUnit: werte.schrittPerUnit,
    };
}

/**
 * Das Reisemodell mit den zwei Zahlen, die aus ihm stammen und in der Systemsteuerung stehen: Meilen je
 * Karteneinheit und der Querfeldein-Aufschlag.
 *
 * 🔴 **Über das Modell, nicht über einen Getter.** Beide werden im Code AUSSCHLIESSLICH als
 * `model.meilenJeKarteneinheit.wert` bzw. `graph.model.querfeldeinAufschlag.wert` gelesen, an einem Dutzend Stellen.
 * Wer sie einzeln verdrahtet, vergisst eine; wer das Modell des Datenstands austauscht, erreicht jede. Stimmen die
 * Zahlen mit dem Modell überein (die Tafel ist leer), kommt dasselbe Objekt zurück — dann ändert sich nicht einmal
 * eine Objektgleichheit.
 */
export function modellMitWerten(model: TravelModel, werte: Wegfindungswerte): TravelModel {
    const meilen = werte.meilenJeKarteneinheit;
    const aufschlag = werte.querfeldeinAufschlag;
    if (meilen === model.meilenJeKarteneinheit.wert && aufschlag === model.querfeldeinAufschlag.wert) return model;
    return {
        ...model,
        meilenJeKarteneinheit: { ...model.meilenJeKarteneinheit, wert: meilen },
        querfeldeinAufschlag: { ...model.querfeldeinAufschlag, wert: aufschlag },
    };
}
