<script setup lang="ts">
/**
 * Die Tafel im Fenster (Guide §12.6, §17.9, §17.12): darin steht eine echte `<table>` - ein Raster ist für sortierbare
 * Listen, eine Tafel, die man nur liest, ist eine Tabelle. 🔴 HIER stehen alle Regeln jeder Tafel, keine Tafel trägt
 * eigene (WI-0076, Betreiber 2026-10-04: „Tabelle B“, das Kopfband):
 *
 * - **Kopfband:** Die Spaltenköpfe stehen auf der Fläche der Klappbox-Kopfzeile (`--color-disclosure-bg`), 11 px, gedämpft.
 * - **Zebra:** Jede zweite Zeile liegt auf der anderen Fläche des Fensters (`--color-panel` auf einer Karte, `--color-panel-soft`
 *   direkt auf dem Fenster, `grund`). Gruppenzeilen (`<th scope="rowgroup">`) zählen nicht mit; sie stehen goldbraun über
 *   einem Strich. Keine Linien zwischen den Zeilen.
 * - **Achsen gedämpft, Werte hell:** Spalten- und Zeilenköpfe in `--color-text-muted` (Legacy: „table axis labels → muted,
 *   BOTH header axes, matched“). Die Werte setzt die Tafel selbst über `AvmText`/`AvmWert`: die Zahl hell mit Ziffern gleicher
 *   Breite, die Einheit gedämpft (Guide §16.3). Zahlen stehen rechtsbündig, Text links, die Ampel mittig.
 * - **Zeilenmaß** 4 / 6 wie jede Liste (§11), Schrift 12 px; `dicht` (eine Tafel in einer Lesespalte, §17.12) 11 px und
 *   seitlich 4.
 *
 * `art`: `zahlen` (Vorgabe: Zeilen sind Dinge, Spalten Zahlen), `text` (Zellen sind Text, links), `matrix` (zwei Achsen,
 * Zellen mittig: Das Band rahmt Kopfzeile UND Zeilenköpfe, eine Zelle mit `data-tier` trägt die Ampel §17.9, eine ohne
 * liegt auf der anderen Fläche; die Spaltenzahl kommt als `--spalten` an der Tabelle). `gleich`: Zahlenspalten gleich breit,
 * der Name nimmt 40 % (`table-layout: fixed`) - dann rollt die Tafel nie, Namen und Köpfe trennen nach Silben.
 *
 * 🔴 Ist die Tafel breiter als das Fenster, rollt SIE waagerecht, nie das Fenster (§17.9); die erste Spalte bleibt dabei
 * stehen. Inhalt: `fenster-tafel__name` (Bild vor dem Namen), `fenster-tafel__kopf` (Bild über dem Namen),
 * `fenster-tafel__zusatz` (eine leise Zeile unter dem Wert), `data-leer` (ein Strich statt eines Wertes).
 */
withDefaults(
    defineProps<{
        /** Wofür die Tafel steht - ihr Name für Vorleser, meist die Aufschrift der Karte darum. */
        beschriftung: string;
        art?: "zahlen" | "text" | "matrix";
        /** Eine Tafel in einer Lesespalte: 11 px, seitlich enger, damit sie nicht rollt. */
        dicht?: boolean;
        /** Zahlenspalten gleich breit, der Name nimmt den Rest; die Tafel rollt nie. */
        gleich?: boolean;
        /** Worauf die Tafel liegt: auf einer Karte (`--color-panel-soft`) oder direkt auf dem Fenster (`--color-panel`). */
        grund?: "karte" | "fenster";
    }>(),
    { art: "zahlen", dicht: false, gleich: false, grund: "karte" },
);
</script>

<template>
    <div
        class="fenster-tafel"
        :class="[
            `fenster-tafel--${art}`,
            `fenster-tafel--auf-${grund}`,
            { 'fenster-tafel--dicht': dicht, 'fenster-tafel--gleich': gleich },
        ]"
        role="region"
        :aria-label="beschriftung"
    >
        <slot />
    </div>
</template>

<style scoped>
.fenster-tafel {
    min-width: 0;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: thin;
}

/* Getrennte Ränder ohne Abstand: Nur so tragen Band und Zebra ihre runden Enden. */
.fenster-tafel :slotted(table) {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
    line-height: var(--leading-snug);
}

.fenster-tafel :slotted(th) {
    font-weight: var(--font-weight-regular);
}

/* --- Das Kopfband --- */

.fenster-tafel :slotted(thead th) {
    padding: var(--space-4);
    background: var(--color-disclosure-bg);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-tight);
    text-align: right;
    vertical-align: bottom;
}

.fenster-tafel :slotted(thead th:first-child) {
    border-radius: var(--radius-sm) 0 0 var(--radius-sm);
    text-align: left;
}

.fenster-tafel :slotted(thead th:last-child) {
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}

/* --- Zeilen: Achse gedämpft, Werte rechts --- */

.fenster-tafel :slotted(tbody th),
.fenster-tafel :slotted(tbody td) {
    padding: var(--space-2) var(--space-4);
    vertical-align: middle;
}

.fenster-tafel :slotted(tbody th) {
    color: var(--color-text-muted);
    text-align: left;
}

.fenster-tafel :slotted(td) {
    color: var(--color-text);
    text-align: right;
    white-space: nowrap;
}

/* Die erste Spalte bleibt beim Rollen stehen, auf der Fläche, auf der die Tafel liegt. */
.fenster-tafel :slotted(thead th:first-child),
.fenster-tafel :slotted(tbody th:first-child) {
    position: sticky;
    left: 0;
    z-index: 1;
}

.fenster-tafel--auf-karte :slotted(tbody th:first-child) {
    background: var(--color-panel-soft);
}

.fenster-tafel--auf-fenster :slotted(tbody th:first-child) {
    background: var(--color-panel);
}

/* --- Zebra: jede zweite Zeile auf der anderen Fläche; Gruppenzeilen zählen nicht --- */

.fenster-tafel--auf-karte:not(.fenster-tafel--matrix)
    :slotted(tbody tr:nth-child(even of :not(:has(> th[scope="rowgroup"]))) > *) {
    background: var(--color-panel);
}

.fenster-tafel--auf-fenster:not(.fenster-tafel--matrix)
    :slotted(tbody tr:nth-child(even of :not(:has(> th[scope="rowgroup"]))) > *) {
    background: var(--color-panel-soft);
}

.fenster-tafel :slotted(tbody tr > :first-child) {
    border-radius: var(--radius-sm) 0 0 var(--radius-sm);
}

.fenster-tafel :slotted(tbody tr > :last-child) {
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}

/* Die Gruppe: goldbraun wie die Aufschrift einer Karte, über einem Strich. */
.fenster-tafel :slotted(tbody th[scope="rowgroup"]) {
    padding-top: var(--space-8);
    border-bottom: 1px solid var(--color-divider);
    border-radius: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    letter-spacing: 0.02em;
}

/* Ein Strich statt eines Wertes: kein Wert, also leise. */
.fenster-tafel :slotted(td[data-leer]),
.fenster-tafel :slotted(td[data-tier="nie"]) {
    color: var(--color-disabled-text);
}

/* --- Text: Zellen links, sie dürfen brechen --- */

.fenster-tafel--text :slotted(thead th) {
    text-align: left;
}

.fenster-tafel--text :slotted(td) {
    text-align: left;
    white-space: normal;
}

/* --- Dicht: eine Tafel in einer Lesespalte --- */

.fenster-tafel--dicht :slotted(table) {
    font-size: var(--font-size-caption);
}

.fenster-tafel--dicht :slotted(thead th),
.fenster-tafel--dicht :slotted(tbody th),
.fenster-tafel--dicht :slotted(td) {
    padding-inline: var(--space-2);
}

.fenster-tafel--dicht :slotted(thead th) {
    white-space: nowrap;
}

/* --- Gleich: Zahlenspalten gleich breit, die Tafel rollt nie --- */

.fenster-tafel--gleich :slotted(table) {
    table-layout: fixed;
}

.fenster-tafel--gleich :slotted(thead th:first-child) {
    width: 40%;
}

/* Die Silbentrennung steht seit WI-0088 P3 als Hausregel in `styles/canon.css` und erbt hierher; hier bleibt nur der Notbruch. */
.fenster-tafel--gleich :slotted(th) {
    overflow-wrap: break-word;
}

/* --- Matrix: zwei Achsen, das Band rahmt beide, die Zellen mittig --- */

.fenster-tafel--matrix :slotted(th) {
    width: calc(100% / var(--spalten, 1));
}

.fenster-tafel--matrix :slotted(thead th),
.fenster-tafel--matrix :slotted(thead th:last-child) {
    padding: var(--space-4) var(--space-2) var(--space-6);
    border-radius: 0;
    text-align: center;
}

.fenster-tafel--matrix :slotted(thead th:first-child) {
    padding-left: var(--space-6);
    border-radius: var(--radius-sm) 0 0;
    text-align: left;
}

.fenster-tafel--matrix :slotted(thead th:last-child) {
    border-radius: 0 var(--radius-sm) 0 0;
}

.fenster-tafel--matrix :slotted(tbody th:first-child) {
    padding: var(--space-4) var(--space-6);
    border-radius: 0;
    background: var(--color-disclosure-bg);
}

.fenster-tafel--matrix :slotted(tbody tr:last-child th:first-child) {
    border-radius: 0 0 0 var(--radius-sm);
}

/* Die Zellen: mittig, durch 2 px Fläche getrennt statt durch Linien (§17.9); kein Zebra, die Ampel trägt die Fläche. */
.fenster-tafel--matrix :slotted(tbody tr > *),
.fenster-tafel--matrix :slotted(tbody tr > :last-child) {
    border-radius: 0;
}

.fenster-tafel--matrix :slotted(td) {
    padding: var(--space-4) var(--space-2);
    border-top: 2px solid var(--color-panel);
    border-left: 2px solid var(--color-panel);
    background: transparent;
    text-align: center;
}

/* Eine Zeile ohne Ampel (die Tagesleistung) liegt auf der anderen Fläche. */
.fenster-tafel--matrix :slotted(td:not([data-tier])) {
    background: var(--color-panel);
}

/* Farbe trägt hier einen WERT (§17.9, SPECIAL CASE): je Stufe Fläche und Schrift als Paar. */
.fenster-tafel :slotted(td[data-tier="schnell"]) {
    background: var(--color-tier-fast-bg);
    color: var(--color-tier-fast-text);
}

.fenster-tafel :slotted(td[data-tier="mittel"]) {
    background: var(--color-tier-mid-bg);
    color: var(--color-tier-mid-text);
}

.fenster-tafel :slotted(td[data-tier="langsam"]) {
    background: var(--color-tier-slow-bg);
    color: var(--color-tier-slow-text);
}

/* --- Inhalt der Zellen --- */

/* Ein Name mit Bild davor; Inhaltsbilder in voller Farbe, nie umgefärbt (§13.42). */
.fenster-tafel :slotted(.fenster-tafel__name) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-6);
}

/* Ein Spaltenkopf mit Bild darüber; er bricht nicht um, eher rollt die Tafel. */
.fenster-tafel :slotted(.fenster-tafel__kopf) {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    white-space: nowrap;
}

.fenster-tafel :slotted(.fenster-tafel__name img),
.fenster-tafel :slotted(.fenster-tafel__kopf img) {
    flex: none;
    width: var(--icon-sm);
    height: var(--icon-sm);
    object-fit: contain;
    pointer-events: none;
}

/*
 * Eine leise Zeile unter dem Wert („ohne Rast“): eine Erklärung, keine zweite Zahl. Sie darf an ihren Wörtern brechen -
 * sie soll die Spalte nicht breiter machen als ihre Zahl (am Telefon passt die Meerreise sonst nicht).
 */
.fenster-tafel :slotted(.fenster-tafel__zusatz) {
    display: block;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    white-space: normal;
}
</style>
