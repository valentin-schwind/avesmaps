<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import { t } from "../i18n/i18n";
import {
    BILD_INLINE_MAX_BYTES,
    MAIL_SANDBOX,
    baueSrcdoc,
    eingebetteteBilder,
    externSatz,
    schaetzeHoehe,
} from "./mail-ansicht-modell";

/**
 * Eine HTML-Mail in einer abgeschotteten Fläche (WI-0268 C6b; Bedienkonzept §3.2, Fachkonzept §3.4). Das HTML kam bereinigt vom Server; hier steht es zusätzlich in einem `iframe` mit `sandbox` OHNE
 * `allow-scripts` und OHNE `allow-same-origin` (`MAIL_SANDBOX`) und mit eigener Inhaltsrichtlinie im `srcdoc` (`mailCsp`): kein Skript, keine Cookies, keine fremden Anfragen.
 *
 * - **Höhe:** ohne Skript lässt sich der Inhalt nicht messen. Die Höhe ist eine Schätzung aus dem Inhalt (`schaetzeHoehe`), begrenzt; darüber rollt die Fläche selbst.
 * - **Eingebettete Bilder** holt diese Seite selbst mit den Cookies der Redaktion (die abgeschottete Fläche hat keine) und reicht sie als `data:` hinein; zu große bleiben aus.
 * - **Externe Bilder** sind blockiert; „Einmal laden“ setzt ihr `src` NUR in dieser Ansicht und erweitert die Inhaltsrichtlinie um `https:`. Es merkt sich nichts.
 * - Unter der Fläche steht „HTML-Mail, bereinigt dargestellt.“ und, wenn Bilder blockiert sind, wie viele.
 */
const props = defineProps<{
    html: string;
    externBilder: number;
    testid?: string | undefined;
}>();

const extern = ref(false);
const bilder = ref<ReadonlyMap<string, string>>(new Map());
const herkunft = typeof window === "undefined" ? "" : window.location.origin;

const srcdoc = computed(() => baueSrcdoc(props.html, { herkunft, extern: extern.value, bilder: bilder.value }));
const hoehe = computed(() => schaetzeHoehe(props.html));

function alsDataUrl(blob: Blob): Promise<string | undefined> {
    return new Promise((fertig) => {
        const leser = new FileReader();
        leser.onload = () => fertig(typeof leser.result === "string" ? leser.result : undefined);
        leser.onerror = () => fertig(undefined);
        leser.readAsDataURL(blob);
    });
}

async function ladeBilder(): Promise<void> {
    const geladen = new Map<string, string>();
    for (const adresse of eingebetteteBilder(props.html)) {
        try {
            const antwort = await fetch(adresse, { credentials: "same-origin" });
            if (!antwort.ok) continue;
            const blob = await antwort.blob();
            if (!blob.type.startsWith("image/") || blob.size > BILD_INLINE_MAX_BYTES) continue;
            const daten = await alsDataUrl(blob);
            if (daten !== undefined) geladen.set(adresse, daten);
        } catch {
            // Ein Bild, das nicht kommt, bleibt leer; der Rest der Mail steht trotzdem da.
        }
    }
    bilder.value = geladen;
}

onMounted(() => void ladeBilder());
watch(
    () => props.html,
    () => {
        extern.value = false;
        void ladeBilder();
    },
);
</script>

<template>
    <div class="mail" :data-testid="testid ?? 'community-mail'">
        <iframe
            class="mail__flaeche"
            :sandbox="MAIL_SANDBOX"
            :srcdoc="srcdoc"
            :style="{ height: `${hoehe}px` }"
            :title="t('community.mails.html.titel')"
            referrerpolicy="no-referrer"
            loading="lazy"
            :data-testid="`${testid ?? 'community-mail'}-flaeche`"
        ></iframe>
        <p class="mail__hinweis" :data-testid="`${testid ?? 'community-mail'}-hinweis`">
            {{ t("community.mails.html.bereinigt") }}
        </p>
        <p
            v-if="externBilder > 0 && !extern"
            class="mail__hinweis mail__extern"
            :data-testid="`${testid ?? 'community-mail'}-extern`"
        >
            <span>{{ externSatz(externBilder) }}</span>
            <AvmKnopf groesse="zeile" :testid="`${testid ?? 'community-mail'}-einmal`" @click="extern = true">{{
                t("community.mails.html.einmalLaden")
            }}</AvmKnopf>
        </p>
        <p v-else-if="externBilder > 0" class="mail__hinweis" :data-testid="`${testid ?? 'community-mail'}-geladen`">
            {{ t("community.mails.html.externGeladen") }}
        </p>
    </div>
</template>

<style scoped>
.mail {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

/* Die Fläche der Mail: ruhig gerahmt, über die ganze Breite; die Höhe schätzt das Skript des Bauteils aus dem Inhalt (die Fläche selbst hat kein Skript). */
.mail__flaeche {
    display: block;
    width: 100%;
    min-height: 96px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-panel);
}

.mail__hinweis {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.mail__extern {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-6);
}
</style>
