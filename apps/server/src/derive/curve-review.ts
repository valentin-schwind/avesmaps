/** Bestehende kartografische Abnahmen (2026-09-21/23), unverändert aus verify-runs. */
export const KNOWN_OUTLIERS = [
    "Dragwallthal",
    "Farlornschwelle",
    "Tommellande",
    "Rathilswall",
    "Dschungel von Atoum",
    "Amboss",
    // Kam dazu, als die Fenster zur Längensicherung größer geschnitten wurden (I2): ein
    // längeres Fenster auf einer gebogenen Kurve tritt weiter aus. Der Tausch ist bewusst -
    // ein abgeschnittener Name ist schlimmer als ein Name, der eine Bucht überquert.
    "Horobans Wälder",
    // ✅ Vom Betreiber abgenommen 2026-09-23 (WI-0018). Sichtbar geworden,
    // seit jede Stufe ihren eigenen Lauf hat: I5 misst jetzt genau das Stück, das die Karte auf
    // dieser Stufe zeigt. Vorher maß sie den langen Lauf des ganzen Bandes, während die Kachel
    // bei hohem Zoom nur dessen Mitte zeigte - und die lag bei diesen vier schon damals genauso
    // weit draußen (nachgerechnet: gleicher Innenanteil vorher und nachher). Alle liegen auf
    // Legacys Kurve, höchstens 1,3 Einheiten daneben.
    "Dschungel des östlichen Regengebirges",
    "Eisklingenschlucht",
    "Gangreb Flusstal",
    "Östlicher Hangwald der Windhagberge",
    // Die einzige echte Verschiebung, ebenfalls abgenommen: die erste von drei Instanzen sucht auf z7 und z8 ihr
    // ruhigstes Stück jetzt für die eigene Namenslänge, wie Legacy beim Zeichnen - und findet es
    // dort, wo die Kurve die Fläche verlässt (vorher 100, jetzt 41 bis 49 Prozent innen).
    "Flusslande",
];

/** Der Betreiber behält zusätzlich konkave Einzelpolygone mit Schwerpunkt außen (2026-09-30). */
export function acceptedCurveOutside(name: string, concaveSinglePolygon: boolean): boolean {
    return concaveSinglePolygon || KNOWN_OUTLIERS.includes(name);
}
