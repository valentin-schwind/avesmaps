<script setup lang="ts">
import { computed, nextTick, reactive, shallowRef, useTemplateRef, watch } from "vue";
import { DESIGN_CANON, LEGAL_NOTICES } from "@avesmaps3d/shared";
import AvmFenster from "../fenster/avm-fenster.vue";
import { locale, t } from "../i18n/i18n";
import { oeffneKontakt } from "../community/community-besucher";
import ToastHost from "../feedback/toast-host.vue";
import { showLinkToast } from "../feedback/toast";
import { copyToClipboard } from "../route-planner/use-share-link";
import { inhaltsstand } from "../system/inhaltsstand";
import { geradePausiert } from "../system/inhaltsstand-text";
import { hinweisAdresse, hinweisAusSuche, sucheOhneHinweis } from "./hinweis-adresse";
import HinweiseAbschnitt from "./hinweise-abschnitt.vue";
import HinweiseBedienung from "./hinweise-bedienung.vue";
import { abschnittJeKennung, istBedienung } from "./hinweise-dokument";
import HinweiseDokument from "./hinweise-dokument.vue";
import HinweiseKacheln from "./hinweise-kacheln.vue";
import { ladeHinweise, type HinweiseFassung } from "./hinweise-sprachen";
import type { HinweiseZiel } from "./hinweise-ziel";

/**
 * Das Fenster „Hinweise“ (Kapitel 5.5; WI-0045 Stufe B nach Legacys `#legal-dialog`, Guide §12.6).
 * Ein Blatt in der Breite `lesen`, ohne Zeichen: diese Datei liefert NUR den Inhalt, die Hülle ist
 * `AvmFenster`.
 *
 * Aufbau (Betreiber 2026-09-27): oben das Fanprojekt-Logo, darunter zwei Aktionskacheln, dann die
 * Abschnitte klappbar - zugeklappt das Inhaltsverzeichnis. Seit dem abgenommenen Mockup vom 2026-11-04 stehen sie als EIN Dokument in
 * der Konfiguration (`LEGAL_NOTICES.hinweise`, `config/legal/notices.json`). 🔴 Hier steht kein Rechtstext; jede Fassung und jede
 * Änderung nimmt der Betreiber ab (AGENTS.md). Jede andere Sprache kommt erst, wenn sie gebraucht wird (`hinweise-sprachen.ts`), mit dem Satz, dass die deutsche Fassung gilt.
 *
 * Jede Stelle hat eine Kennung und das Linkzeichen 🔗: Ein Klick kopiert `<origin>/?hinweis=<kennung>`, ein solcher Link öffnet das Fenster dort (`app.vue`). 🔴 Ein Query-Parameter, weil der Hash der Kamera gehört.
 * „Hinweise“ ist modal, liegt also in der obersten Ebene über dem Toast der Seite: Darum hängt hier, solange das Fenster offen ist, ein eigener `ToastHost`. Er zeigt dieselbe Meldung am selben Platz, und nur er lässt sich
 * markieren und vorlesen, weil außerhalb eines modalen Fensters alles träge ist.
 *
 * Blendet die Systemsteuerung gerade etwas aus (WI-0127 SYS-10, Inhaltsschalter), steht unter den Kacheln die Zeile „Gerade pausiert: …“
 * (SYS-0001 §6.6: das Info-Menü der Karte).
 */
const props = defineProps<{
    /** Wo das Fenster aufgeht (`hinweise-ziel.ts`): Der Abschnitt klappt auf, die Stelle rückt ins Bild, eine unbekannte Kennung öffnet nur das Fenster. */
    abschnitt?: HinweiseZiel | null | undefined;
}>();
const offen = defineModel<boolean>("offen", { required: true });
const emit = defineEmits<{ news: [] }>();

/**
 * „Nachricht schreiben“ (WI-0268 C4): Das Kontaktformular ist ein Werkzeugfenster der Besucher (`community/kontakt-fenster.vue`) und steht neben dem Panel, nicht in diesem Fenster. Die Hinweise gehen darum
 * zu und das Formular auf; so verdeckt kein Blatt die Karte, und das Formular behält seine Lage.
 */
function schreibeNachricht(): void {
    offen.value = false;
    oeffneKontakt();
}

/** Die Fassung in der Sprache des Lesers; `undefined`, solange sie noch unterwegs ist. */
const fassung = shallowRef<HinweiseFassung | undefined>(undefined);
let ladung: Promise<void> = Promise.resolve();
watch(
    locale,
    (sprache) => {
        ladung = ladeHinweise(sprache).then((neu) => {
            if (locale.value === sprache) fassung.value = neu;
        });
    },
    { immediate: true },
);
// Aufbau und Kennungen sind in jeder Sprache dieselben.
const zuAbschnitt = abschnittJeKennung(LEGAL_NOTICES.hinweise);
const aufgeklappt = reactive<Record<string, boolean>>({});
const abschnitte = useTemplateRef<HTMLElement>("abschnitte");
const pausiertZeile = computed(() => geradePausiert(inhaltsstand.aus()));
const uebersetzungsSatz = computed(() => fassung.value?.uebersetzung ?? "");

/** Die Testkennungen der Abschnitte; sie hängen nicht an den öffentlichen Adressen. */
const TESTKENNUNG: Readonly<Record<string, string>> = {
    bedienung: "notes-controls",
    "haeufige-fragen": "notes-faq",
    "projekt-und-mitmachen": "notes-project",
    "inhalte-und-datenquellen": "notes-sources",
    "karten-auf-avesmaps": "notes-maps",
    "urheberrecht-marken-und-bildrechte": "notes-copyright",
    "technik-und-kuenstliche-intelligenz": "notes-tech",
    reisebilder: "notes-photobox",
    "grenzen-der-karte-und-haftung": "notes-liability",
    datenschutz: "notes-privacy",
    "kontakt-und-impressum": "notes-imprint",
};

/** Luft zwischen dem klebenden Band des Abschnitts und der Stelle, zu der gerollt wird. */
const LUFT_UNTER_DEM_BAND = DESIGN_CANON.space["6"] ?? 0;

/** 🔴 Nur der Rumpf des Fensters rollt: `scrollIntoView` verschöbe auch die Seite dahinter. Das klebende Band des Abschnitts geht ab, sonst läge die Stelle darunter. */
function rolleHin(ziel: HTMLElement, sanft: boolean): void {
    const rumpf = ziel.closest<HTMLElement>(".avm-fenster__rumpf");
    if (!rumpf) return;
    const band = ziel.matches("details")
        ? 0
        : (ziel.closest("details")?.querySelector("summary")?.offsetHeight ?? 0) + LUFT_UNTER_DEM_BAND;
    const ohneBewegung = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    rumpf.scrollTo({
        top: rumpf.scrollTop + ziel.getBoundingClientRect().top - rumpf.getBoundingClientRect().top - band,
        behavior: sanft && !ohneBewegung ? "smooth" : "auto",
    });
}

function hebeHervor(ziel: HTMLElement): void {
    ziel.classList.remove("hinweis-ziel");
    // Ein zweiter Sprung auf dieselbe Stelle soll wieder aufleuchten: Der Browser muss die Klasse dazwischen ohne sie gesehen haben.
    void ziel.offsetWidth;
    ziel.classList.add("hinweis-ziel");
    ziel.addEventListener("animationend", () => ziel.classList.remove("hinweis-ziel"), { once: true });
}

async function zeige(kennung: string, sanft: boolean): Promise<void> {
    const abschnitt = zuAbschnitt.get(kennung);
    if (abschnitt === undefined) return;
    await ladung;
    aufgeklappt[abschnitt] = true;
    await nextTick();
    const ziel = abschnitte.value?.querySelector<HTMLElement>(`[data-hinweis="${kennung}"]`);
    if (!ziel) return;
    rolleHin(ziel, sanft);
    hebeHervor(ziel);
    // Beim Laden über einen Link steht die Hausschrift oft noch nicht: Ihr Umbruch verschöbe die Stelle um Zeilen.
    if (!sanft) void globalThis.document.fonts?.ready.then(() => rolleHin(ziel, false));
}

/** Der Link hat seinen Dienst getan: Sonst öffnete ihn das Neuladen wieder, und er liefe in jede Adresse mit, die man danach weitergibt. */
function vergissHinweisInDerAdresse(): void {
    const { pathname, search, hash } = globalThis.location;
    if (hinweisAusSuche(search) === null) return;
    globalThis.history.replaceState(globalThis.history.state, "", `${pathname}${sucheOhneHinweis(search)}${hash}`);
}

watch(
    [offen, () => props.abschnitt],
    async ([jetzt, ziel]) => {
        if (!jetzt) {
            vergissHinweisInDerAdresse();
            return;
        }
        if (!ziel) return;
        // 🪤 Zweimal: Die Hülle öffnet ihr `<dialog>` selbst erst nach einem Tick, und ein geschlossenes rollt nicht.
        await nextTick();
        await nextTick();
        await zeige(ziel, false);
        // `immediate`: Das Fenster lädt beim ersten Öffnen nach und hängt sich dann schon offen ein (WI-0235, `einmal-offen.ts`).
    },
    { immediate: true },
);

async function kopiereLink(kennung: string): Promise<void> {
    const url = hinweisAdresse(globalThis.location.origin, kennung);
    const kopiert = await copyToClipboard(Promise.resolve(url));
    showLinkToast(t(kopiert ? "notes.anker.copied" : "notes.anker.copyFailed", { url }), url);
}

/**
 * Die Klicks im Dokument, an EINER Stelle statt an jedem der gut zweihundert Linkzeichen und jedem Verweis. Mit Strg oder Umschalt tut ein Sprung, was ein Link dann tut.
 * 🪤 Das Linkzeichen im Kopf eines Abschnitts schaltet ihn nicht um: Ein Link in `<summary>` nimmt den Klick selbst.
 */
function klickImDokument(ereignis: MouseEvent): void {
    if (!(ereignis.target instanceof Element)) return;
    const anker = ereignis.target.closest<HTMLElement>("[data-hinweis-anker]")?.dataset["hinweisAnker"];
    if (anker !== undefined) {
        ereignis.preventDefault();
        void kopiereLink(anker);
        return;
    }
    if (ereignis.target.closest("[data-hinweis-kontakt]")) {
        schreibeNachricht();
        return;
    }
    const sprung = ereignis.target.closest<HTMLElement>("[data-hinweis-sprung]")?.dataset["hinweisSprung"];
    if (sprung === undefined || ereignis.ctrlKey || ereignis.metaKey || ereignis.shiftKey) return;
    ereignis.preventDefault();
    void zeige(sprung, true);
}
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="blatt"
        breite="lesen"
        rumpf-buendig
        :titel="t('notes.title')"
        testid="notes"
    >
        <div class="wappen">
            <img
                class="wappen__bild"
                src="/img/dsa-fanprojekt-logo.webp"
                width="480"
                height="138"
                loading="lazy"
                :alt="t('notes.badge.alt')"
            />
            <span class="wappen__zeile">{{ t("notes.badge") }}</span>
        </div>

        <HinweiseKacheln @news="emit('news')" />

        <p v-if="pausiertZeile !== null" class="pausiert" data-testid="notes-paused">{{ pausiertZeile }}</p>

        <!-- Welche Fassung der Rechtstexte gilt, steht vor ihnen, nicht in einem Abschnitt (WI-0032). -->
        <p v-if="uebersetzungsSatz" class="sprache" data-testid="notes-translation-note">
            {{ uebersetzungsSatz }}
        </p>

        <div v-if="fassung !== undefined" ref="abschnitte" class="abschnitte" @click="klickImDokument">
            <HinweiseAbschnitt
                v-for="abschnitt in fassung.dokument.abschnitte"
                :key="abschnitt.id"
                :kennung="abschnitt.id"
                :offen="aufgeklappt[abschnitt.id] === true"
                :titel="abschnitt.titel"
                :hinweis="abschnitt.hinweis"
                :testid="TESTKENNUNG[abschnitt.id]"
                @update:offen="aufgeklappt[abschnitt.id] = $event"
            >
                <HinweiseBedienung v-if="istBedienung(abschnitt)" />
                <HinweiseDokument v-else :bloecke="abschnitt.bloecke" />
            </HinweiseAbschnitt>
        </div>

        <!-- Der Schlusssatz steht unter der Liste, nicht in einem Abschnitt (Legacy `.legal-dialog__note`). -->
        <p v-if="fassung !== undefined" class="schluss" data-testid="notes-changes">{{ fassung.dokument.schluss }}</p>

        <ToastHost v-if="offen" />
    </AvmFenster>
</template>

<style scoped>
/*
 * Nur der Inhalt: Hülle, Kopf, Rumpf und ihre Maße gehören `AvmFenster`. Die Werte sind Legacys
 * `css/components/legal-dialog.css`, auf Kanon-Tokens, mit der Schriftfarbe je Rolle: Lesetext
 * gedämpft, Überschriften goldbraun, Betonung stark.
 */

/*
 * Das Logo mittig, darunter die Kennzeichnung als Fanprojekt (Legacy `.legal-dialog__badge`). Oben trägt es das Polster, das der Rumpf hier nicht hat (`rumpf-buendig`):
 * Die Bänder der Abschnitte kleben sonst mit einer Lücke unter dem Kopf, und durch die Lücke scheint der Text.
 */
.wappen {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    padding-top: var(--space-6);
    text-align: center;
}

/* Ein Inhaltsbild: rahmenlos, in voller Farbe, nie umgefärbt (§13.42). */
.wappen__bild {
    display: block;
    width: min(var(--icon-banner), 100%);
    height: auto;
}

.wappen__zeile {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    font-weight: var(--font-weight-bold);
    letter-spacing: 0.04em;
    text-transform: uppercase;
}

.sprache,
.pausiert {
    color: var(--color-text-muted);
    font-size: var(--font-size-body);
    line-height: var(--leading-normal);
}

/* Die Abschnitte stehen als Karten untereinander; was die Bedienung nicht selbst setzt, erbt sie von hier (13 px, 1.45 wie Legacy). */
.abschnitte {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    font-size: var(--font-size-body);
    line-height: var(--leading-normal);
}

/* Der Schlusssatz steht unter allen Abschnitten, kleiner und gedämpft (Legacy `.legal-dialog__note`). */
.schluss {
    margin: var(--space-8) 0 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}
</style>

<!-- Nicht scoped: Die Stelle gehört einem Kindbauteil, und erst das Fenster setzt die Klasse. -->
<style>
.hinweis-ziel {
    animation: hinweis-ziel 1800ms ease-out;
}

@keyframes hinweis-ziel {
    from {
        background: color-mix(in srgb, var(--color-accent) 26%, transparent);
    }

    to {
        background: transparent;
    }
}

/* Ohne Bewegung: dieselbe Hervorhebung für dieselbe Zeit, nur ohne das Ausblenden. */
@media (prefers-reduced-motion: reduce) {
    .hinweis-ziel {
        animation-timing-function: steps(1, end);
    }
}
</style>
