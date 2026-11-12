<script setup lang="ts">
/**
 * Die interaktive Liste (AUTH-0001 §12.3, Guide §13.13; Mockup `review/admin-mockup/` „Personen“ und „Handy“; WI-0120 A10): Dinge,
 * an denen man handelt - die Tafel (`fenster-tafel.vue`) ist für das, was man nur liest. 🔴 HIER stehen die Regeln jeder solchen
 * Liste, keine Liste trägt eigene:
 *
 * - **Am Rechner eine Tabelle:** Die Kopfzeile in Versalien, 11 px, gedämpft, ist die einzige Linie (Mockup „Tabelle als Raster“);
 *   Zeilen ohne Fläche und ohne Linie, Werte 12 px. Die erste Spalte nimmt den Rest, die anderen sind so breit wie ihr Inhalt und
 *   brechen nicht um. Ist die Tabelle breiter als das Fenster, rollt SIE waagerecht, nie das Fenster (wie die Tafel, §17.9).
 * - **Eine Folgezeile** (`<tr class="fenster-raster__nach">`) trägt, was zu der Zeile darüber gehört: eine Bestätigung, eine Meldung.
 *   Leer verschwindet sie.
 * - **Am Telefon Karten** (§13.13: „die Karte hebt den einzelnen Eintrag heraus“; Mockup „Handy“): eine Mulde, darin je Eintrag
 *   eine Karte mit Kopf (`__kopf`: Name links, Status rechts), Feldzeilen „Beschriftung: Wert“ (`__felder`, ein `<dl>`) und den
 *   Handlungen unten (`__handlungen`). Der Aufrufer schreibt `<ul class="fenster-raster__karten">` mit `<li class="fenster-raster__karte">`.
 */
defineProps<{
    /** Wofür die Liste steht, ihr Name für Vorleser. */
    beschriftung: string;
}>();
</script>

<template>
    <div class="fenster-raster" role="region" :aria-label="beschriftung">
        <slot />
    </div>
</template>

<style scoped>
.fenster-raster {
    min-width: 0;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: thin;
}

/* --- Am Rechner: die Tabelle --- */

.fenster-raster :slotted(table) {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
}

.fenster-raster :slotted(th) {
    padding: 0 var(--space-8) var(--space-2) 0;
    border-bottom: 1px solid var(--color-divider);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-regular);
    letter-spacing: var(--letter-spacing-caps);
    text-align: left;
    text-transform: uppercase;
    white-space: nowrap;
}

.fenster-raster :slotted(td) {
    padding: var(--space-2) var(--space-8) var(--space-2) 0;
    color: var(--color-text);
    vertical-align: middle;
    white-space: nowrap;
}

.fenster-raster :slotted(th:first-child) {
    width: 100%;
}

.fenster-raster :slotted(th:last-child),
.fenster-raster :slotted(td:last-child) {
    padding-right: 0;
}

/* Luft unter der Kopfzeile, damit die erste Zeile nicht an der Linie klebt. */
.fenster-raster :slotted(tbody > tr:first-child > td) {
    padding-top: var(--space-4);
}

.fenster-raster :slotted(.fenster-raster__nach > td) {
    padding: 0 0 var(--space-6);
    white-space: normal;
}

.fenster-raster :slotted(.fenster-raster__nach:has(> td:empty)) {
    display: none;
}

/* --- Am Telefon: Karten in einer Mulde --- */

.fenster-raster :slotted(.fenster-raster__karten) {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    margin: 0;
    padding: var(--space-6);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
    list-style: none;
}

.fenster-raster :slotted(.fenster-raster__karte) {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
}

.fenster-raster :slotted(.fenster-raster__kopf) {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
}

.fenster-raster :slotted(.fenster-raster__felder) {
    display: grid;
    grid-template-columns: var(--avm-field-label-w) minmax(0, 1fr);
    align-items: center;
    gap: var(--space-4) var(--space-8);
    margin: 0;
}

.fenster-raster :slotted(.fenster-raster__felder dt) {
    color: var(--color-text-muted);
}

.fenster-raster :slotted(.fenster-raster__felder dd) {
    min-width: 0;
    margin: 0;
    color: var(--color-text-strong);
}

.fenster-raster :slotted(.fenster-raster__handlungen) {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-6);
}
</style>
