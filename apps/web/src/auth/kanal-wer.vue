<script setup lang="ts">
import type { KanalWer } from "@avesmaps3d/shared";
import AvmAvatar from "../controls/avm-avatar.vue";
import KanalSiegel from "./kanal-siegel.vue";
import { discordName, werName } from "./kanal";

/**
 * Wer etwas tat: Claudia und Claudio mit Siegel und eigener Farbe, eine Person mit Avatar (WI-0124, Betreiber 2026-10-10). `discord`: der
 * Anzeigename einer Meldung aus Discord (WI-0255 Paket 2), ohne Avatar, denn es ist keine Person der App.
 */
const props = defineProps<{ wer: KanalWer | null; klein?: boolean | undefined; discord?: string | undefined }>();
</script>

<template>
    <span class="wer">
        <KanalSiegel
            v-if="props.discord === undefined && (props.wer?.art === 'claudia' || props.wer?.art === 'claudio')"
            :agent="props.wer.art"
            groesse="klein"
        />
        <AvmAvatar
            v-else-if="props.discord === undefined && props.wer?.art === 'person'"
            :kennung="props.wer.id"
            :name="props.wer.name"
            groesse="klein"
        />
        <span v-if="props.discord !== undefined" class="wer__name" data-testid="kanal-wer-discord">{{
            discordName(props.discord)
        }}</span>
        <span
            v-else
            class="wer__name"
            :class="props.wer?.art === 'person' || props.wer === null ? '' : `wer__name--${props.wer.art}`"
            >{{ werName(props.wer) }}</span
        >
    </span>
</template>

<style scoped>
.wer {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    white-space: nowrap;
}

.wer__name {
    color: var(--color-text-strong);
}

.wer__name--claudia {
    color: var(--color-agent-claudia);
}

.wer__name--claudio {
    color: var(--color-agent-claudio);
}
</style>
