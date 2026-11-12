<script setup lang="ts">
/**
 * Ein Link im Text des Panels, der ein anderes Subject öffnet (Hauptstadt, Verkehrsweg, Gebiet in der Treppe, Herrschaft im Untertitel).
 * Legacy `.location-popup__political-link`: goldbraun, nie blau, Unterstreichung erst beim Überfahren - die Zeile bleibt ruhig.
 *
 * Es ist ein Knopf, kein `<a>`: Er führt nirgends hin, er öffnet ein Subject über die EINE Öffnungsnaht des Panels. Den Fokus zeigt der
 * goldene Ring (Guide §30.3, `:focus-visible`), nicht der Browserring.
 *
 * 🔴 `tail` ist das Satzzeichen, das im Text direkt auf den Link folgt (`withTrailingPunctuation` in `panel-text.ts`). Ein Knopf ist ein
 * Kasten, und hinter einem Kasten darf der Browser umbrechen, auch vor einem Komma - es begann dann eine Zeile (Gareth, Abnahmeblatt
 * Bildbezug). Darum wird das Zeichen IM Kasten gezeichnet, direkt hinter dem Namen, in der Farbe des Textes und ohne Unterstreichung
 * (erzeugter Inhalt mit leerem Alternativtext; deshalb trägt der Name die Linkfarbe, nicht der Knopf). Als Text steht es weiter HINTER
 * dem Knopf, unsichtbar und ohne Platz im Fluss: Der Absatz liest sich, kopiert und klingt wie vorher, und der Text des Knopfes bleibt
 * genau der Name.
 */
defineProps<{ tail?: string | undefined }>();
const emit = defineEmits<{ open: [] }>();
</script>

<template>
    <button type="button" class="info-link" :data-tail="tail" data-testid="info-link" @click="emit('open')">
        <span class="info-link__name"><slot /></span>
    </button>
    <span v-if="tail !== undefined" class="info-link__tail" data-testid="info-link-tail">{{ tail }}</span>
</template>

<style scoped>
.info-link {
    display: inline;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    cursor: pointer;
    font: inherit;
    line-height: inherit;
    overflow-wrap: anywhere;
    text-align: left;
}

.info-link__name {
    color: var(--color-link);
    transition: color 120ms ease;
}

.info-link:hover .info-link__name {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.info-link:active .info-link__name {
    color: var(--color-link-hover);
}

.info-link:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

/* Das Satzzeichen im Kasten: gezeichnet, nie vorgelesen (die Zeile davor ist der Rückfall ohne Alternativschreibweise, canon.css ↗). */
.info-link[data-tail]::after {
    content: attr(data-tail);
    content: attr(data-tail) / "";
}

/* Dasselbe Zeichen als Text: für Vorleser, Kopieren und den Text des Absatzes, ohne Platz im Fluss (wie `info-stars.vue`). */
.info-link__tail {
    position: absolute;
    overflow: hidden;
    clip-path: inset(50%);
    width: 1px;
    height: 1px;
    white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
    .info-link__name {
        transition: none;
    }
}
</style>
