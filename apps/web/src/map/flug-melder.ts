/**
 * Der Melder: Was tut die Karte in der Sekunde, bevor das Telefon den Tab beendet?
 *
 * Anlass (Betreiber 2026-10-12): Chrome auf dem iPhone beendet den Zugriff, sobald eine lange Route in 3D abgespielt wird. Auf dem
 * Entwicklungsrechner ist nichts davon zu sehen — WebKit mit iPhone-Profil und Chromium mit Grafikkarte halten durch, und der Reihe
 * nach ausgeschlossen sind: ein Leck (Erzeugen und Löschen der GL-Objekte halten sich die Waage, Texturbytes und Heap flach), der
 * Hauptthread (ein einziger Long Task), die Zahl der Kacheln (70 % weniger stürzt genauso ab), die Zahl der Quellen (andere
 * Landschaftsebene, gleiches Verhalten) und GPU-Rücklesen (null `readPixels`).
 *
 * Also muss die Spur vom Gerät kommen. Der Melder schickt jede Sekunde ein paar Zahlen an einen Horcher im selben Netz; stirbt der
 * Tab, ist die letzte Meldung schon draußen und sagt, was unmittelbar davor geschah.
 *
 * 🔴 **Nur im Entwicklungsbuild und nur auf Zuruf.** `import.meta.env.DEV` ist im gebauten Release `false`, und ohne `?melder=1`
 * passiert auch lokal nichts. Kein Produktschalter, keine Oberfläche, nichts gemerkt, nichts auf Stage.
 *
 *     …/edit?route=…&melder=1#…        schickt an http://<derselbe Host>:5177/melder
 *     …&melder=1&melderport=5178#…     anderer Port
 *
 * Gegenstelle: `node scripts/dev/flug-horcher.mjs` (schreibt jede Meldung in eine Zeile).
 */

/** Was eine Meldung trägt. Alles Zahlen, nichts Persönliches. */
interface Meldung {
    /** Sekunden seit dem Start des Melders. */
    t: number;
    /** Bilder seit der letzten Meldung. */
    bilder: number;
    zoom: number;
    neigung: number;
    gelaende: 0 | 1;
    /**
     * Kachelanfragen seit der letzten Meldung, die der HAUPTTHREAD sieht.
     * 🪤 MapLibre laedt Kacheln in Arbeitern; deren Anfragen tauchen hier nicht auf, die Zahl bleibt darum meist 0.
     * Die Last der Kacheln steht in `buffer`, `vao` und `hochMb`.
     */
    kacheln: number;
    /** Gleichzeitig offen: erzeugte minus gelöschte. */
    buffer: number;
    textur: number;
    vao: number;
    /** Von uns gezählte Texturbytes, in MB. */
    texturMb: number;
    /** Seit der letzten Meldung auf die GPU geladen, in MB. */
    hochMb: number;
    /** Long Tasks seit der letzten Meldung und ihre Summe in Millisekunden. */
    /**
     * 1, sobald der Browser den WebGL-Kontext weggenommen hat (`webglcontextlost`). Diese Meldung geht SOFORT hinaus, nicht erst
     * im nächsten Takt: Sie unterscheidet „die GPU hat aufgegeben“ von „der Browser hat die ganze Seite beendet“.
     */
    verloren: 0 | 1;
    lang: number;
    langMs: number;
    /** Nur wo der Browser es hergibt (Chromium); auf iOS fehlt es. */
    heapMb: number | null;
    /**
     * Welche Stellschrauben in der Adresse stehen (`handy`, `gelaende`, `kachelprotokoll`, `flugneigung`, `flughoehe`).
     * 💣 Ohne das lassen sich mehrere Versuche hinterher nicht auseinanderhalten: Am 2026-10-12 probierte der Betreiber drei
     * Fassungen, und eine hielt 116 statt 2 Sekunden - welche, stand in keiner Meldung.
     */
    schalter: string;
}

const BYTES_JE_PIXEL: Record<number, number> = {
    6408: 4,
    6407: 3,
    6409: 1,
    6410: 2,
    33189: 4,
    34041: 4,
    36012: 4,
    32856: 4,
};

function parameter(name: string): string | null {
    const ort = globalThis.location;
    if (!ort) return null;
    const fragment = ort.hash.startsWith("#") ? ort.hash.slice(1) : ort.hash;
    for (const quelle of [ort.search, fragment]) {
        const wert = new URLSearchParams(quelle).get(name);
        if (wert !== null) return wert;
    }
    return null;
}

/**
 * Hängt den Melder ein, wenn `?melder=1` in der Adresse steht. Gibt die Abmeldung zurück.
 *
 * 🪤 `keepalive` an der Anfrage: Eine Meldung, die beim Sterben des Tabs noch unterwegs ist, geht trotzdem hinaus. `mode: "no-cors"`,
 * damit der Horcher keine Kopfzeilen braucht — die Antwort interessiert nicht.
 */
export function installFlugMelder(karte: {
    getZoom: () => number;
    getPitch: () => number;
    getCanvas?: () => HTMLCanvasElement;
    terrain?: unknown;
}): () => void {
    const stufe = parameter("melder");
    if (!import.meta.env.DEV || (stufe !== "1" && stufe !== "2")) return () => undefined;
    /**
     * 💣 `melder=1` fasst WebGL NICHT an. Der erste Entwurf legte um `createBuffer`, `bufferData`, `texImage2D` und `bindTexture`
     * je eine JS-Hülle — bei rund 250 Buffer-Erzeugungen und tausenden `bufferData` je Sekunde ist das auf dem Telefon selbst eine
     * Last, und auf dem iPhone des Betreibers starb die Seite damit binnen zwei bis vier Sekunden (drei Läufe am 2026-10-12), ohne
     * dass er überhaupt ▶ drücken konnte. Wer eine Grenze sucht, darf sie nicht selbst verschieben.
     *
     * `melder=2` schaltet die Zählung der GL-Gegenstände dazu — für den Rechner, wo die Hüllen nichts kosten.
     */
    const zaehleGl = stufe === "2";
    const port = parameter("melderport") ?? "5177";
    const ziel = `http://${globalThis.location.hostname}:${port}/melder`;

    let bilder = 0;
    let kacheln = 0;
    let lang = 0;
    let langMs = 0;
    let hochBytes = 0;
    let texturBytes = 0;
    const offen = { buffer: 0, textur: 0, vao: 0 };
    const groessen = new WeakMap<object, number>();
    /** Die zuletzt an `TEXTURE_2D` gebundene Textur je Kontext - mitgeschrieben, nie erfragt (siehe unten). */
    const gebundeneTextur = new WeakMap<object, object | undefined>();
    const TEXTURE_2D = 0x0de1;

    const kontexte = zaehleGl
        ? [globalThis.WebGL2RenderingContext, globalThis.WebGLRenderingContext].filter(Boolean)
        : [];
    const zurueck: (() => void)[] = [];
    for (const kontext of kontexte) {
        const proto = (kontext as unknown as { prototype: Record<string, unknown> }).prototype;
        const ersetze = (name: string, bauen: (original: never) => unknown): void => {
            const original = proto[name];
            if (typeof original !== "function") return;
            proto[name] = bauen(original as never);
            zurueck.push(() => {
                proto[name] = original;
            });
        };
        for (const [name, feld, schritt] of [
            ["createBuffer", "buffer", 1],
            ["deleteBuffer", "buffer", -1],
            ["createTexture", "textur", 1],
            ["createVertexArray", "vao", 1],
            ["deleteVertexArray", "vao", -1],
        ] as const) {
            ersetze(name, (original) => {
                const fn = original as unknown as (...args: unknown[]) => unknown;
                return function (this: unknown, ...args: unknown[]) {
                    offen[feld] += schritt;
                    return fn.apply(this, args);
                };
            });
        }
        ersetze("deleteTexture", (original) => {
            const fn = original as unknown as (...args: unknown[]) => unknown;
            return function (this: unknown, ...args: unknown[]) {
                offen.textur -= 1;
                const groesse = groessen.get(args[0] as object);
                if (groesse !== undefined) texturBytes -= groesse;
                return fn.apply(this, args);
            };
        });
        ersetze("bufferData", (original) => {
            const fn = original as unknown as (...args: unknown[]) => unknown;
            return function (this: unknown, ...args: unknown[]) {
                const daten = args[1];
                hochBytes +=
                    typeof daten === "number" ? daten : ((daten as { byteLength?: number } | null)?.byteLength ?? 0);
                return fn.apply(this, args);
            };
        });
        // 💣 Die gebundene Textur wird MITGESCHRIEBEN, nie erfragt. Ein `getParameter` je Hochladung war der erste Entwurf; das ist
        // eine Abfrage an die GPU, die den Betrieb anhält, und auf dem iPhone starb die Seite damit binnen zwei Sekunden beim Laden
        // (gemeldet am 2026-10-12, zwei Läufe, jeweils t=2). Eine Messhilfe, die misst, was sie selbst verursacht, taugt nichts.
        ersetze("bindTexture", (original) => {
            const fn = original as unknown as (...args: unknown[]) => unknown;
            return function (this: object, ...args: unknown[]) {
                if (args[0] === TEXTURE_2D) gebundeneTextur.set(this, (args[1] as object | null) ?? undefined);
                return fn.apply(this, args);
            };
        });
        /**
         * 💣 `texImage2D` hat ZWEI Formen, und sie zu verwechseln kostet jede Zahl ihre Bedeutung:
         *
         *     (ziel, stufe, format, breite, hoehe, rand, format, typ, pixel)   neun Argumente, Maße an 3 und 4
         *     (ziel, stufe, format, format, typ, quelle)                       sechs Argumente, Maße an der Quelle
         *
         * Der erste Entwurf las Index 3 und 4 immer als Maße. In der sechsargumentigen Form sind das `format` und `typ`, also
         * `gl.RGBA` = 6408 und `gl.UNSIGNED_BYTE` = 5121 — und der Melder meldete daraufhin eine Textur von „6408 × 5121“ und
         * 126 MB, die es nie gab (das Pfeilbild ist rund 109 × 109). Unterschieden wird jetzt an der Zahl der Argumente.
         */
        ersetze("texImage2D", (original) => {
            const fn = original as unknown as (...args: unknown[]) => unknown;
            return function (this: object, ...args: unknown[]) {
                const ergebnis = fn.apply(this, args);
                if (args[1] === 0) {
                    const quelle = args.length <= 6 ? (args[5] as { width?: number; height?: number } | null) : null;
                    const breite = args.length >= 9 ? ((args[3] as number) ?? 0) : (quelle?.width ?? 0);
                    const hoehe = args.length >= 9 ? ((args[4] as number) ?? 0) : (quelle?.height ?? 0);
                    const groesse = breite * hoehe * (BYTES_JE_PIXEL[args[2] as number] ?? 4);
                    const gebunden = gebundeneTextur.get(this);
                    if (groesse > 0 && gebunden) {
                        texturBytes += groesse - (groessen.get(gebunden) ?? 0);
                        groessen.set(gebunden, groesse);
                    }
                }
                return ergebnis;
            };
        });
    }

    const zaehleBild = (): void => {
        bilder += 1;
        rafId = globalThis.requestAnimationFrame(zaehleBild);
    };
    let rafId = globalThis.requestAnimationFrame(zaehleBild);

    const beobachter: PerformanceObserver[] = [];
    const horche = (typ: string, auf: (eintrag: PerformanceEntry) => void): void => {
        try {
            const beobachter_ = new PerformanceObserver((liste) => {
                for (const eintrag of liste.getEntries()) auf(eintrag);
            });
            beobachter_.observe({ type: typ, buffered: false });
            beobachter.push(beobachter_);
        } catch {
            // Ein Browser, der die Art nicht kennt, meldet sie eben nicht.
        }
    };
    horche("resource", (eintrag) => {
        if (eintrag.name.includes("/tiles/")) kacheln += 1;
    });
    horche("longtask", (eintrag) => {
        lang += 1;
        langMs += eintrag.duration;
    });

    /**
     * Die Stellschrauben dieser Adresse, einmal gelesen: `drape=0.5 handy=3` oder leer.
     *
     * 🪤 Hier gehört JEDE Stellschraube aus `flug-probe.ts` hinein. Am 2026-10-12 fehlte `drape`, und zwei Läufe des Betreibers
     * ließen sich hinterher nicht mehr auseinanderhalten — die Messung war da, die Zuordnung fehlte.
     */
    const SCHALTER = [
        "drape",
        "dpr",
        "handy",
        "gelaende",
        "kachelprotokoll",
        "flugneigung",
        "flughoehe",
        "cache",
        "cachezoom",
        "parallel",
        "maxneigung",
        "eigene",
        "dunst",
        "leiste",
        "derographie",
        "vegetation",
        "flaechen",
        "ohne",
        "deckend",
        "relief",
    ]
        .map((name) => {
            const wert = parameter(name);
            return wert === null ? "" : `${name}=${wert.replace(/[^a-z0-9.-]/giu, "").slice(0, 12)}`;
        })
        .filter((eintrag) => eintrag !== "")
        .join(" ");

    const begonnen = Date.now();
    let verloren: 0 | 1 = 0;
    const schicke = (): void => {
        const speicher = (globalThis.performance as { memory?: { usedJSHeapSize: number } }).memory;
        const meldung: Meldung = {
            t: Math.round((Date.now() - begonnen) / 100) / 10,
            bilder,
            zoom: Math.round(karte.getZoom() * 100) / 100,
            neigung: Math.round(karte.getPitch()),
            gelaende: karte.terrain ? 1 : 0,
            kacheln,
            buffer: offen.buffer,
            textur: offen.textur,
            vao: offen.vao,
            texturMb: Math.round(texturBytes / 1048576),
            hochMb: Math.round((hochBytes / 1048576) * 10) / 10,
            verloren,
            lang,
            langMs: Math.round(langMs),
            heapMb: speicher ? Math.round(speicher.usedJSHeapSize / 1048576) : null,
            schalter: SCHALTER,
        };
        bilder = 0;
        kacheln = 0;
        lang = 0;
        langMs = 0;
        hochBytes = 0;
        void fetch(ziel, {
            method: "POST",
            mode: "no-cors",
            keepalive: true,
            headers: { "content-type": "text/plain" },
            body: JSON.stringify(meldung),
        }).catch(() => undefined);
    };
    const uhr = globalThis.setInterval(schicke, 1000);

    // Nimmt der Browser den Kontext weg, geht die Meldung SOFORT hinaus - das unterscheidet „die GPU hat aufgegeben" von „die
    // ganze Seite wurde beendet". Die Fläche holt sich MapLibre selbst; hier wird nur gehorcht.
    const flaeche = (karte.getCanvas?.() ?? undefined) as EventTarget | undefined;
    const aufVerlust = (): void => {
        verloren = 1;
        schicke();
    };
    flaeche?.addEventListener("webglcontextlost", aufVerlust);

    return () => {
        globalThis.clearInterval(uhr);
        globalThis.cancelAnimationFrame(rafId);
        flaeche?.removeEventListener("webglcontextlost", aufVerlust);
        for (const eintrag of beobachter) eintrag.disconnect();
        for (const auf of zurueck) auf();
    };
}
