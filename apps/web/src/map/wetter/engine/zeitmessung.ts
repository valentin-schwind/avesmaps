/**
 * GPU-Zeit je Durchgang, nur auf Anfrage (`gpuZeiten`): eine Zeitabfrage je Abschnitt, Ergebnis als Mittel je Bild in ms. Ohne die
 * Erweiterung (oder mit `mitFinish`) misst sie über `gl.finish` und die Uhr des Browsers.
 */

/** EXT_disjoint_timer_query_webgl2; die DOM-Typen kennen die Erweiterung nicht. */
export interface ZeitAbfrage {
    readonly TIME_ELAPSED_EXT: number;
    readonly GPU_DISJOINT_EXT: number;
}

/** Mittel je Bild in ms je Abschnitt, dazu `summe`, `gestoert` (Bilder mit gestörter Messung) und `zeitabfrage` (1 mit der Erweiterung). */
export type GpuZeiten = Readonly<Record<string, number>>;

export interface Messlauf {
    readonly ext: ZeitAbfrage | null;
    bilder: number;
    n: number;
    offen: { readonly name: string; readonly q: WebGLQuery }[];
    /** Der laufende Abschnitt mit Zeitabfrage. */
    abfrage: { readonly name: string; readonly q: WebGLQuery } | null;
    /** Der laufende Abschnitt mit `gl.finish`. */
    lauf: { readonly name: string; readonly t: number } | null;
    readonly summe: Record<string, number>;
    gestoert: number;
    readonly fertig: (aus: GpuZeiten) => void;
}

/** Die laufende Messung der Engine, `null` ohne Anfrage. */
export interface GpuUhr {
    zm: Messlauf | null;
}

export const neuerMesslauf = (ext: ZeitAbfrage | null, bilder: number, fertig: (aus: GpuZeiten) => void): Messlauf => ({
    ext,
    bilder,
    n: 0,
    offen: [],
    abfrage: null,
    lauf: null,
    summe: {},
    gestoert: 0,
    fertig,
});

/** Den laufenden Abschnitt schließen und, mit `name`, den nächsten beginnen. */
export function zAb(gl: WebGL2RenderingContext, uhr: GpuUhr, name: string | null): void {
    const z = uhr.zm;
    if (!z) return;
    if (!z.ext) {
        if (z.lauf) {
            gl.finish();
            z.summe[z.lauf.name] = (z.summe[z.lauf.name] || 0) + performance.now() - z.lauf.t;
            z.lauf = null;
        }
        if (name && z.bilder > 0) {
            gl.finish();
            z.lauf = { name, t: performance.now() };
        }
        return;
    }
    if (z.abfrage) {
        gl.endQuery(z.ext.TIME_ELAPSED_EXT);
        z.offen.push(z.abfrage);
        z.abfrage = null;
    }
    if (name && z.bilder > 0) {
        const q = gl.createQuery();
        gl.beginQuery(z.ext.TIME_ELAPSED_EXT, q);
        z.abfrage = { name, q };
    }
}

/** Fertige Abfragen einsammeln; sind alle Bilder gemessen, das Ergebnis melden und die Messung beenden. */
export function zLies(gl: WebGL2RenderingContext, uhr: GpuUhr): void {
    const z = uhr.zm;
    if (!z) return;
    const dis = z.ext ? (gl.getParameter(z.ext.GPU_DISJOINT_EXT) as boolean) : false;
    if (dis) z.gestoert++;
    z.offen = z.offen.filter((e) => {
        if (!gl.getQueryParameter(e.q, gl.QUERY_RESULT_AVAILABLE)) return true;
        if (!dis)
            z.summe[e.name] = (z.summe[e.name] || 0) + (gl.getQueryParameter(e.q, gl.QUERY_RESULT) as number) / 1e6;
        gl.deleteQuery(e.q);
        return false;
    });
    if (z.bilder <= 0 && !z.offen.length) {
        const aus: Record<string, number> = {};
        let s = 0;
        for (const k in z.summe) {
            aus[k] = +(z.summe[k]! / z.n).toFixed(3);
            s += z.summe[k]! / z.n;
        }
        aus["summe"] = +s.toFixed(3);
        aus["gestoert"] = z.gestoert;
        // Gemessen mit der Zeitabfrage der GPU (1) oder über `gl.finish` und die Uhr des Browsers (0, etwa am Telefon ohne die Erweiterung).
        aus["zeitabfrage"] = z.ext ? 1 : 0;
        uhr.zm = null;
        z.fertig(aus);
    }
}

/** Ein Bild ist gezeichnet. */
export function zBild(uhr: GpuUhr): void {
    const z = uhr.zm;
    if (z && z.bilder > 0) {
        z.bilder--;
        z.n++;
    }
}
