/**
 * Liest eine Ebene aus einer Vektorkachel (Mapbox Vector Tile 2.1), so weit die Verdunstung nach Vegetation sie braucht
 * (`ladeVegetation` in `engine/daten.ts`): Eigenschaften und Ringe jedes Objekts in Kachelpunkten.
 *
 * 🪤 Ein eigener kleiner Leser statt `@mapbox/vector-tile` und `pbf` (WI-0288 Stufe 1): Beide sind keine Abhängigkeiten der
 * Weboberfläche, nur MapLibres, und die Typen von `@mapbox/vector-tile` ziehen `@types/geojson` ins Programm. Damit wird MapLibres
 * `GeoJSON.Geometry` streng, und der Typcheck fiel in fremden Dateien (`area-labels.ts`, `owners.ts`, `vorkommen-namen.ts`).
 *
 * Wie `loadGeometry` von `@mapbox/vector-tile`: Jedes „MoveTo“ beginnt einen Ring, „ClosePath“ wiederholt dessen ersten Punkt.
 */
export type MvtWert = string | number | boolean;

export interface MvtObjekt {
    eigenschaften: Readonly<Record<string, MvtWert>>;
    /** Die Ringe (oder Linien und Punkte) in Kachelpunkten, 0 bis `extent`. */
    ringe: { x: number; y: number }[][];
}

export interface MvtEbene {
    extent: number;
    objekte: MvtObjekt[];
}

const UTF8 = new TextDecoder();
const VARINT = 0;
const FEST64 = 1;
const LAENGE = 2;
const FEST32 = 5;

class Leser {
    pos: number;
    readonly ende: number;
    private readonly daten: Uint8Array;
    private readonly sicht: DataView;

    constructor(daten: Uint8Array, anfang = 0, ende = daten.length) {
        this.daten = daten;
        this.pos = anfang;
        this.ende = ende;
        this.sicht = new DataView(daten.buffer, daten.byteOffset, daten.byteLength);
    }

    /** Ohne Bitoperationen, damit auch 64-Bit-Zahlen bis 2^53 genau bleiben. */
    varint(): number {
        let wert = 0;
        let faktor = 1;
        let byte: number;
        do {
            byte = this.daten[this.pos++] ?? 0;
            wert += (byte & 0x7f) * faktor;
            faktor *= 128;
        } while (byte & 0x80);
        return wert;
    }

    /** Ein Stück mit Längenangabe: gibt Anfang und Ende zurück und springt dahinter. */
    stueck(): [number, number] {
        const laenge = this.varint();
        const anfang = this.pos;
        this.pos += laenge;
        return [anfang, this.pos];
    }

    text(): string {
        const [anfang, ende] = this.stueck();
        return UTF8.decode(this.daten.subarray(anfang, ende));
    }

    float(): number {
        const wert = this.sicht.getFloat32(this.pos, true);
        this.pos += 4;
        return wert;
    }

    double(): number {
        const wert = this.sicht.getFloat64(this.pos, true);
        this.pos += 8;
        return wert;
    }

    ueberspringe(art: number): void {
        if (art === VARINT) this.varint();
        else if (art === FEST64) this.pos += 8;
        else if (art === LAENGE) this.stueck();
        else if (art === FEST32) this.pos += 4;
        else throw new Error(`Vektorkachel: unbekannte Feldart ${String(art)}`);
    }

    /** Ruft `je` für jedes Feld bis zum Ende; was `je` nicht liest, wird übersprungen. */
    felder(je: (feld: number, art: number) => boolean): void {
        while (this.pos < this.ende) {
            const schluessel = this.varint();
            const feld = Math.floor(schluessel / 8);
            const art = schluessel & 7;
            if (!je(feld, art)) this.ueberspringe(art);
        }
    }
}

const zickzack = (n: number): number => (n % 2 === 1 ? -(n + 1) / 2 : n / 2);

function leseZahlen(daten: Uint8Array, [anfang, ende]: [number, number]): number[] {
    const leser = new Leser(daten, anfang, ende);
    const zahlen: number[] = [];
    while (leser.pos < ende) zahlen.push(leser.varint());
    return zahlen;
}

function leseWert(daten: Uint8Array, [anfang, ende]: [number, number]): MvtWert {
    let wert: MvtWert = "";
    const leser = new Leser(daten, anfang, ende);
    leser.felder((feld, art) => {
        if (feld === 1 && art === LAENGE) wert = leser.text();
        else if (feld === 2 && art === FEST32) wert = leser.float();
        else if (feld === 3 && art === FEST64) wert = leser.double();
        else if (feld === 4 && art === VARINT) {
            // int64: Negative Zahlen stehen im Zweierkomplement über 64 Bit.
            const n = leser.varint();
            wert = n >= 2 ** 63 ? n - 2 ** 64 : n;
        } else if (feld === 5 && art === VARINT) wert = leser.varint();
        else if (feld === 6 && art === VARINT) wert = zickzack(leser.varint());
        else if (feld === 7 && art === VARINT) wert = leser.varint() !== 0;
        else return false;
        return true;
    });
    return wert;
}

function leseRinge(befehle: readonly number[]): { x: number; y: number }[][] {
    const ringe: { x: number; y: number }[][] = [];
    let ring: { x: number; y: number }[] | undefined;
    let x = 0;
    let y = 0;
    let i = 0;
    while (i < befehle.length) {
        const befehl = befehle[i++] ?? 0;
        const art = befehl & 7;
        const anzahl = Math.floor(befehl / 8);
        if (art === 7) {
            const erster = ring?.[0];
            if (ring && erster) ring.push({ ...erster });
            continue;
        }
        for (let k = 0; k < anzahl; k++) {
            x += zickzack(befehle[i++] ?? 0);
            y += zickzack(befehle[i++] ?? 0);
            if (art === 1 || !ring) {
                ring = [];
                ringe.push(ring);
            }
            ring.push({ x, y });
        }
    }
    return ringe;
}

/** Die Ebene `name` der Kachel, oder `undefined`, wenn die Kachel sie nicht hat. */
export function leseMvtEbene(daten: Uint8Array, name: string): MvtEbene | undefined {
    let gefunden: MvtEbene | undefined;
    const kachel = new Leser(daten);
    kachel.felder((feld, art) => {
        if (feld !== 3 || art !== LAENGE || gefunden) return false;
        const [anfang, ende] = kachel.stueck();
        let ebenenName = "";
        let extent = 4096;
        const schluessel: string[] = [];
        const werte: MvtWert[] = [];
        const objekte: [number, number][] = [];
        const ebene = new Leser(daten, anfang, ende);
        ebene.felder((f, a) => {
            if (f === 1 && a === LAENGE) ebenenName = ebene.text();
            else if (f === 2 && a === LAENGE) objekte.push(ebene.stueck());
            else if (f === 3 && a === LAENGE) schluessel.push(ebene.text());
            else if (f === 4 && a === LAENGE) werte.push(leseWert(daten, ebene.stueck()));
            else if (f === 5 && a === VARINT) extent = ebene.varint();
            else return false;
            return true;
        });
        if (ebenenName !== name) return true;
        gefunden = {
            extent,
            objekte: objekte.map(([von, bis]) => {
                let marken: number[] = [];
                let befehle: number[] = [];
                const objekt = new Leser(daten, von, bis);
                objekt.felder((f, a) => {
                    if (f === 2 && a === LAENGE) marken = leseZahlen(daten, objekt.stueck());
                    else if (f === 4 && a === LAENGE) befehle = leseZahlen(daten, objekt.stueck());
                    else return false;
                    return true;
                });
                const eigenschaften: Record<string, MvtWert> = {};
                for (let k = 0; k + 1 < marken.length; k += 2) {
                    const s = schluessel[marken[k] ?? -1];
                    const w = werte[marken[k + 1] ?? -1];
                    if (s !== undefined && w !== undefined) eigenschaften[s] = w;
                }
                return { eigenschaften, ringe: leseRinge(befehle) };
            }),
        };
        return true;
    });
    return gefunden;
}
