<script setup lang="ts">
import HinweiseAnker from "./hinweise-anker.vue";

/**
 * Ein klappbarer Abschnitt in „Hinweise“ (WI-0045 Stufe B; Legacy `.legal-section`, `.legal-dialog__group`).
 * Zugeklappt sind die Abschnitte das Inhaltsverzeichnis des Fensters, aufgeklappt sein Inhalt
 * (Legacy-Owner 2026-08-05).
 *
 * - 🔴 `<details>`/`<summary>` ist NATIV und bleibt es: nur so findet die Seitensuche (Strg+F) Text in
 *   einem zugeklappten Abschnitt und klappt ihn selbst auf - bei Impressum und Lizenzen eine Frage der
 *   Auffindbarkeit (Legacy). Fokus, Enter, Leertaste und der Zustand für Vorleser kommen vom Element.
 * - EIN Zeichen je Zeile: das Dreieck zeigt nach rechts und kippt beim Aufklappen nach unten.
 * - Die Hinweiszeile sagt, was im Abschnitt steckt, ohne ihn zu öffnen.
 * - Eine Karte mit Band (abgenommenes Mockup vom 2026-11-04): Beim Rollen bleibt das Band oben stehen, solange der Abschnitt im Bild ist. 🔴 Seine Fläche ist darum deckend, auch bei Hover und Fokus; darunter rollt Text weg.
 *   `overflow: clip` rundet die Ecken, ohne einen Rollbereich zu öffnen: Das Band klebt weiter am Rumpf des Fensters. Der Fokusring liegt innen, sonst schnitte der Rand der Karte ihn ab.
 *
 * Nur „Hinweise“ braucht ihn; ein zweites Fenster zieht ihn nach `fenster/` (Guide §12.6).
 */
const props = defineProps<{ kennung: string; titel: string; hinweis: string; testid?: string | undefined }>();
const offen = defineModel<boolean>("offen", { default: false });

function umgeschaltet(event: Event): void {
    offen.value = (event.target as HTMLDetailsElement).open;
}
</script>

<template>
    <details
        class="hinweise-abschnitt"
        :open="offen"
        :data-hinweis="props.kennung"
        :data-testid="props.testid"
        @toggle="umgeschaltet"
    >
        <summary class="hinweise-abschnitt__kopf hinweis-traeger">
            <h3 class="hinweise-abschnitt__titel">{{ props.titel }}</h3>
            <span class="hinweise-abschnitt__hinweis">{{ props.hinweis }}</span>
            <HinweiseAnker class="hinweise-abschnitt__anker" :kennung="props.kennung" :punkt="props.titel" />
        </summary>
        <div class="hinweise-abschnitt__inhalt"><slot /></div>
    </details>
</template>

<style scoped>
/* Oberste Stufe: eine Karte, das Band klebt in ihr. */
.hinweise-abschnitt {
    overflow: clip;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

/* Raster statt Flex: das Dreieck steht mittig über Titel UND Hinweiszeile, und das browsereigene Dreieck weicht. */
.hinweise-abschnitt__kopf {
    position: sticky;
    top: 0;
    z-index: 3;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    column-gap: var(--space-6);
    padding: var(--space-8) var(--space-12);
    background: var(--color-disclosure-bg);
    color: var(--color-accent-strong);
    cursor: pointer;
    list-style: none;
    transition:
        background-color 120ms ease,
        box-shadow 120ms ease;
}

.hinweise-abschnitt__kopf::-webkit-details-marker {
    display: none;
}

.hinweise-abschnitt[open] > .hinweise-abschnitt__kopf {
    border-bottom: 1px solid var(--color-border);
}

/* Hover und Fokus legen sich als Ton in die deckende Fläche; der Fokus dazu mit seinem Ring (§30.3). */
.hinweise-abschnitt__kopf:hover,
.hinweise-abschnitt__kopf:focus-visible {
    background: color-mix(in srgb, var(--color-disclosure-bg) 88%, var(--color-text));
}

.hinweise-abschnitt__kopf:focus-visible {
    outline: none;
    box-shadow: inset var(--focus-ring, 0 0 0 3px var(--color-focus));
}

/* Ein Quadrat mit Dreiecksschnitt, das sich um sich selbst dreht (Legacy: ein Rahmen-Dreieck verrutschte). */
.hinweise-abschnitt__kopf::before {
    grid-row: 1 / -1;
    grid-column: 1;
    width: var(--space-8);
    height: var(--space-8);
    background: var(--color-accent-strong);
    clip-path: polygon(22% 4%, 88% 50%, 22% 96%);
    content: "";
    transition: transform 150ms ease;
}

.hinweise-abschnitt[open] > .hinweise-abschnitt__kopf::before {
    transform: rotate(90deg);
}

/* 15 px wie in Legacy, eine Stufe über der Zwischenüberschrift (14): Innen steht nie etwas größer als außen. */
.hinweise-abschnitt__titel {
    grid-row: 1;
    grid-column: 2;
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-toast);
    font-weight: var(--font-weight-regular);
    letter-spacing: 0.01em;
    line-height: var(--leading-snug);
}

.hinweise-abschnitt__hinweis {
    grid-row: 2;
    grid-column: 2;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}

.hinweise-abschnitt__anker {
    grid-row: 1 / span 2;
    grid-column: 3;
    align-self: center;
}

.hinweise-abschnitt__inhalt {
    padding: var(--space-12) var(--space-16) var(--space-16);
}

@media (max-width: 560px) {
    .hinweise-abschnitt__inhalt {
        padding-inline: var(--space-10);
    }
}

@media (prefers-reduced-motion: reduce) {
    .hinweise-abschnitt__kopf,
    .hinweise-abschnitt__kopf::before {
        transition: none;
    }
}
</style>
