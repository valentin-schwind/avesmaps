<script setup lang="ts">
import { t } from "../i18n/i18n";
import { DISCORD_EINLADUNG } from "./community";

/**
 * „Zur Community“: der beschriftete Discord-Knopf, oben in der Kachel und im Impressum derselbe. Sein ↗ kommt aus der Hausregel `a[target="_blank"]::after` (`styles/canon.css`, WI-0107).
 */
</script>

<template>
    <a class="kachel__knopf kachel__knopf--weg" :href="DISCORD_EINLADUNG" target="_blank" rel="noopener noreferrer">
        <svg class="kachel__glyphe" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
                d="M19.3 5.6A16 16 0 0 0 15.4 4.4l-.2.4a12 12 0 0 0-6.4 0l-.2-.4a16 16 0 0 0-3.9 1.2C2.3 9.3 1.6 12.9 2 16.4a16 16 0 0 0 4.8 2.4l.9-1.5a10 10 0 0 1-1.5-.7l.4-.3a11.4 11.4 0 0 0 9.8 0l.4.3a10 10 0 0 1-1.5.7l.9 1.5a16 16 0 0 0 4.8-2.4c.5-4-.6-7.6-2.7-10.8ZM8.7 14.3c-.9 0-1.7-.9-1.7-1.9s.8-1.9 1.7-1.9 1.7.9 1.7 1.9-.7 1.9-1.7 1.9Zm6.6 0c-.9 0-1.7-.9-1.7-1.9s.8-1.9 1.7-1.9 1.7.9 1.7 1.9-.7 1.9-1.7 1.9Z"
            />
        </svg>
        <span>{{ t("notes.social.action") }}</span>
    </a>
</template>

<style scoped src="./hinweise-knopf.css"></style>
