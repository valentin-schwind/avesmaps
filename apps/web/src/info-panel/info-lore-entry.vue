<script setup lang="ts">
import { inject } from "vue";
import type { SubjectRef } from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import { EINTRAG_OEFFNEN } from "./eintrag-oeffnen";
import InfoLink from "./info-link.vue";
import InfoMarked from "./info-marked.vue";
import type { LoreEntryModel } from "./lore-model";

/**
 * EIN Name einer Vorkommens- oder Stättenzeile (WI-0091, WI-0109): ein Objektlink, wo sein Wiki-Schlüssel genau ein
 * Kartenobjekt trägt, sonst - bei einem Vorkommen - ein Link auf die Infobox des Vorkommens (`loreEntry`, `eintrag-oeffnen.ts`), bei einer
 * Stätte ein Link auf den Wiki-Artikel, sonst reiner Text - nie ein toter Link. Der Wiki-Artikel eines Vorkommens steht in dessen Infobox.
 *
 * Eigenes Bauteil, seit derselbe Name an zwei Stellen steht (WI-0122): im Buchstabenregister und in einer Zeile „Art · Stätte“
 * der Sammelgruppe. Zwei Abschriften desselben Namens liefen auseinander.
 *
 * 🔴 Ein Name OHNE Artikel ist nicht bleich, sondern erbt `--color-text-strong`: Der Server lässt nur
 * `https://de.wiki-aventurica.de/` als Ziel zu (`WIKI_HOST` in `subjects/sections/lore.ts`), weil „javascript:…“ jedes Escaping
 * überlebt; was dort durchfällt, ist Text und soll wie Text aussehen.
 *
 * 🔴 Der Sprung ⊕ einer Stätte (`entry.jump`) steht direkt hinter SEINEM Namen; er ist **auch für Besucher** da, kein
 * Editorrecht, und er entsteht nur, wo das Ziel ein aktives Kartenobjekt ist - nie ein toter Sprung.
 *
 * `tail` ist das Komma der Reihe hinter diesem Namen. Hinter einem Objektlink steht es in dessen Kasten (`info-link.vue`): Ein Knopf
 * ist ein Kasten, und davor begänne es sonst eine Zeile. Hinter einem Wiki-Artikel, einem Text und dem Sprung steht es als Text.
 */
const props = defineProps<{ entry: LoreEntryModel; needle?: string | undefined; tail?: string | undefined }>();
const emit = defineEmits<{ open: [ref: SubjectRef] }>();
const eintragOeffnen = inject(EINTRAG_OEFFNEN, undefined);

/**
 * Der Name öffnet sein Ziel. 🔴 Ein Vorkommen öffnet seine Infobox über DIESELBE Hand wie ein Treffer der Suche (Titel sofort, am Telefon Pille und Einklappen); ohne Hand oder ohne Art
 * läuft er wie jeder Objektlink über `open`.
 */
function oeffne(): void {
    const ref = props.entry.ref;
    if (ref === undefined) return;
    if (ref.kind === "loreEntry" && eintragOeffnen !== undefined && props.entry.loreKind !== undefined) {
        eintragOeffnen(ref.id, props.entry.text, props.entry.loreKind);
        return;
    }
    emit("open", ref);
}
</script>

<template>
    <InfoLink v-if="entry.ref !== undefined" :tail="entry.jump === undefined ? tail : undefined" @open="oeffne()"
        ><InfoMarked :text="entry.text" :needle="needle"
    /></InfoLink>
    <a
        v-else-if="entry.href !== undefined"
        class="info-lore__wiki"
        :href="entry.href"
        target="_blank"
        rel="noopener noreferrer"
        ><InfoMarked :text="entry.text" :needle="needle"
    /></a>
    <InfoMarked v-else :text="entry.text" :needle="needle" />
    <!-- Der Sprung auf die Karte, direkt hinter SEINEM Namen; das Zeichen steht im Stylesheet wie jeder andere Glyph im Haus,
         die Bedeutung in der Sprachtafel. -->
    <button
        v-if="entry.jump !== undefined"
        type="button"
        class="info-lore__jump"
        :title="t('infoPanel.staetten.jumpTitle')"
        :aria-label="t('infoPanel.staetten.jumpLabel', { name: entry.text })"
        data-testid="info-staetten-jump"
        @click="emit('open', entry.jump)"
    ></button>
    <template v-if="tail !== undefined && (entry.ref === undefined || entry.jump !== undefined)">{{ tail }}</template>
</template>

<style scoped>
/*
 * Der Sprung ⊕ einer Stätte (WI-0109): ein Knopf in Linkfarbe, so hoch wie die Zeile, ohne eigenen Kasten. Das Zeichen steht im
 * STYLESHEET wie jeder andere Glyph im Haus (`avm-disclosure.vue`, `fenster-verweis.vue`, der Gruppenpfeil in
 * `info-lore-row.vue`); im Markup wäre es ein Text ohne Schlüssel. Seine Bedeutung trägt `aria-label`, nicht das Zeichen.
 */
.info-lore__jump {
    margin: 0 0 0 var(--space-2);
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    line-height: 1;
    transition: color 120ms ease;
}

.info-lore__jump::before {
    content: "⊕";
}

.info-lore__jump:hover,
.info-lore__jump:active {
    color: var(--color-link-hover);
}

.info-lore__jump:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

@media (prefers-reduced-motion: reduce) {
    .info-lore__jump {
        transition: none;
    }
}

/* Ein Wiki-Artikel liest sich wie jeder andere Link im Panel; das Ziel liegt außerhalb der Karte. */
.info-lore__wiki {
    color: var(--color-link);
    text-decoration: none;
    transition: color 120ms ease;
}

.info-lore__wiki:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.info-lore__wiki:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

@media (prefers-reduced-motion: reduce) {
    .info-lore__wiki {
        transition: none;
    }
}
</style>
