<script setup lang="ts">
/**
 * Das Discord-Symbol vor jedem Knopf, der zu Discord führt („Mit Discord anmelden“, „… annehmen“, „… bestätigen“, „Discord
 * verknüpfen“; Betreiber 2026-10-09: „können / dürfen wir bei "Mit discord anmelden" das discord-icon verwenden?“). Im hellen
 * Thema Blurple, im dunklen Weiß (Betreiber 2026-10-09: „weiß im dark theme und blurple im light theme“).
 *
 * 🔴 Die offiziellen Dateien aus dem Markenpaket von discord.com/branding, UNVERÄNDERT (`public/icons/discord/`): Discord erlaubt das
 * Symbol nur so, wie es ist, nicht umgefärbt (Blurple, Schwarz oder Weiß), allein nur dort, wo „Discord“ dabeisteht, und nie so, dass
 * es nach einer Partnerschaft aussieht. Deshalb zwei Bilder statt eines umgefärbten Pfads; das Thema wählt per CSS, welches steht.
 */
const props = defineProps<{
    /** `zeile` für den kleinen Knopf in einer Tafelzeile. */
    groesse?: "normal" | "zeile" | undefined;
}>();
</script>

<template>
    <span class="discord-zeichen" :class="{ 'discord-zeichen--zeile': props.groesse === 'zeile' }">
        <img class="discord-zeichen__hell" src="/icons/discord/Discord-Symbol-Blurple.svg" alt="" decoding="async" />
        <img class="discord-zeichen__dunkel" src="/icons/discord/Discord-Symbol-White.svg" alt="" decoding="async" />
    </span>
</template>

<style scoped>
.discord-zeichen {
    display: block;
    width: var(--icon-md);
}

.discord-zeichen--zeile {
    width: var(--icon-sm);
}

.discord-zeichen__hell,
.discord-zeichen__dunkel {
    width: 100%;
    height: auto;
}

.discord-zeichen__hell {
    display: block;
}

.discord-zeichen__dunkel {
    display: none;
}

:root[data-theme="dark"] .discord-zeichen__hell {
    display: none;
}

:root[data-theme="dark"] .discord-zeichen__dunkel {
    display: block;
}
</style>
