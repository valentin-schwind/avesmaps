/**
 * Liest eine Vektorkachel (Mapbox Vector Tile 2.1, Protobuf), so weit Tests sie brauchen: Ebenen, Merkmale mit Eigenschaften und
 * die Punkte einer Linie in Kachelkoordinaten. Ohne Bibliothek, weil der Server keine Kachel liest, nur schreibt; die Tests prüfen
 * damit, was eine Kachelfunktion wirklich ausliefert, statt ihren Quelltext zu lesen.
 *
 * Spezifikation: https://github.com/mapbox/vector-tile-spec/tree/master/2.1 (Felder: Tile.layers 3; Layer name 1, features 2,
 * keys 3, values 4, extent 5; Feature id 1, tags 2, type 3, geometry 4; Value string 1, float 2, double 3, int 4, uint 5, sint 6,
 * bool 7).
 */

export type MvtWert = string | number | boolean;

export interface MvtMerkmal {
    eigenschaften: Record<string, MvtWert>;
    /** Die Linien des Merkmals, je Linie ihre Punkte in Kachelkoordinaten (0 bis `extent`). */
    linien: { x: number; y: number }[][];
}

export interface MvtEbene {
    name: string;
    extent: number;
    merkmale: MvtMerkmal[];
}

class Leser {
    position: number;

    // 🪤 Ohne Parameter-Eigenschaften: Node liest TypeScript nur durch Entfernen der Typen, und die könnte es nicht.
    private readonly daten: Uint8Array;
    readonly ende: number;

    constructor(daten: Uint8Array, start = 0, ende = daten.length) {
        this.daten = daten;
        this.position = start;
        this.ende = ende;
    }

    get fertig(): boolean {
        return this.position >= this.ende;
    }

    varint(): number {
        let wert = 0;
        let faktor = 1;
        for (;;) {
            const byte = this.daten[this.position++] as number;
            wert += (byte & 0x7f) * faktor;
            if (byte < 0x80) return wert;
            faktor *= 128;
        }
    }

    /** Ein Feld mit Länge: ein Leser nur für dessen Bytes. */
    teil(): Leser {
        const laenge = this.varint();
        const start = this.position;
        this.position += laenge;
        return new Leser(this.daten, start, start + laenge);
    }

    text(): string {
        const teil = this.teil();
        return new TextDecoder().decode(this.daten.subarray(teil.position, teil.ende));
    }

    gepackt(): number[] {
        const teil = this.teil();
        const werte: number[] = [];
        while (!teil.fertig) werte.push(teil.varint());
        return werte;
    }

    zahl(bytes: 4 | 8): number {
        const sicht = new DataView(this.daten.buffer, this.daten.byteOffset + this.position, bytes);
        this.position += bytes;
        return bytes === 4 ? sicht.getFloat32(0, true) : sicht.getFloat64(0, true);
    }

    ueberspringe(art: number): void {
        if (art === 0) this.varint();
        else if (art === 1) this.position += 8;
        else if (art === 2) this.teil();
        else if (art === 5) this.position += 4;
        else throw new Error(`Unbekannte Drahtart ${String(art)}`);
    }
}

const zickzack = (n: number): number => (n % 2 === 0 ? n / 2 : -(n + 1) / 2);

function wert(leser: Leser): MvtWert {
    let ergebnis: MvtWert = "";
    while (!leser.fertig) {
        const schluessel = leser.varint();
        const feld = schluessel >> 3;
        if (feld === 1) ergebnis = leser.text();
        else if (feld === 2) ergebnis = leser.zahl(4);
        else if (feld === 3) ergebnis = leser.zahl(8);
        else if (feld === 4 || feld === 5) ergebnis = leser.varint();
        else if (feld === 6) ergebnis = zickzack(leser.varint());
        else if (feld === 7) ergebnis = leser.varint() !== 0;
        else leser.ueberspringe(schluessel & 7);
    }
    return ergebnis;
}

/** Die Befehle einer Geometrie (MoveTo 1, LineTo 2, ClosePath 7) zu Linien. */
function linien(befehle: readonly number[]): { x: number; y: number }[][] {
    const ergebnis: { x: number; y: number }[][] = [];
    let x = 0;
    let y = 0;
    let i = 0;
    while (i < befehle.length) {
        const befehl = befehle[i++] as number;
        const art = befehl & 7;
        const anzahl = befehl >> 3;
        if (art === 7) continue;
        for (let k = 0; k < anzahl; k += 1) {
            x += zickzack(befehle[i++] as number);
            y += zickzack(befehle[i++] as number);
            if (art === 1) ergebnis.push([]);
            ergebnis[ergebnis.length - 1]?.push({ x, y });
        }
    }
    return ergebnis;
}

export function leseKachel(bytes: Uint8Array): MvtEbene[] {
    const kachel = new Leser(bytes);
    const ebenen: MvtEbene[] = [];
    while (!kachel.fertig) {
        const schluessel = kachel.varint();
        if (schluessel >> 3 !== 3) {
            kachel.ueberspringe(schluessel & 7);
            continue;
        }
        const ebene = kachel.teil();
        let name = "";
        let extent = 4096;
        const schluesselListe: string[] = [];
        const werte: MvtWert[] = [];
        const roh: { tags: number[]; geometrie: number[] }[] = [];
        while (!ebene.fertig) {
            const kopf = ebene.varint();
            const feld = kopf >> 3;
            if (feld === 1) name = ebene.text();
            else if (feld === 3) schluesselListe.push(ebene.text());
            else if (feld === 4) werte.push(wert(ebene.teil()));
            else if (feld === 5) extent = ebene.varint();
            else if (feld === 2) {
                const merkmal = ebene.teil();
                const eintrag = { tags: [] as number[], geometrie: [] as number[] };
                while (!merkmal.fertig) {
                    const k = merkmal.varint();
                    if (k >> 3 === 2) eintrag.tags = merkmal.gepackt();
                    else if (k >> 3 === 4) eintrag.geometrie = merkmal.gepackt();
                    else merkmal.ueberspringe(k & 7);
                }
                roh.push(eintrag);
            } else ebene.ueberspringe(kopf & 7);
        }
        ebenen.push({
            name,
            extent,
            merkmale: roh.map(({ tags, geometrie }) => {
                const eigenschaften: Record<string, MvtWert> = {};
                for (let t = 0; t + 1 < tags.length; t += 2) {
                    eigenschaften[schluesselListe[tags[t] as number] as string] = werte[
                        tags[t + 1] as number
                    ] as MvtWert;
                }
                return { eigenschaften, linien: linien(geometrie) };
            }),
        });
    }
    return ebenen;
}
