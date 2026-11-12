import { computed, nextTick, reactive, ref, shallowRef, useId, watch } from "vue";
import {
    KARTE_VERSION_MAX,
    KARTENVORSCHLAG_LIMITS,
    type KartenvorschlagDetail,
    type MamKarteZeile,
} from "@avesmaps3d/shared";
import type { MessageKey } from "../i18n/de";
import { t } from "../i18n/i18n";
import { createMedienClient } from "../medien/medien-client";
import { erstesWort } from "../medien/medien-karte-zusammenlegen-modell";
import { SCHRITT_SATZ, annehme, ladeVorschlag, lehneAb, schrittFehler } from "./kartenvorschlaege-api";
import { faktenVon, folgenVon, fussVon, technikName, verlaufVon, type OrtWahl } from "./kartenvorschlaege-modell";
import { genauerGrund, type Abbildung } from "../system/ablehnung";
import { REDAKTION_FEHLER_SATZ, redaktionFehler } from "./redaktion-api";
import { redaktion, type VorgangBezug } from "./redaktion";

/**
 * Die Sätze zu den Ablehnungen eines Schritts (`details.reason` von Annehmen und Ablehnen, WI-0291). Ein Grund ohne eigenen Satz zeigt den des Servers (`genauerGrund`),
 * nie mehr den Ortsatz für jeden 422 (Inventar WI-0291 Nr. 14).
 */
const SCHRITT_ABLEHNUNG: Abbildung = {
    gruende: {
        ort_unbekannt: () => t(SCHRITT_SATZ.ort),
        grund_leer: () => t("kartenvorschlag.redaktion.ablehnung.grundLeer"),
    },
    felder: {
        grund: () => t("kartenvorschlag.redaktion.ablehnung.grundLang", { n: KARTENVORSCHLAG_LIMITS.grundMax }),
        versionLabel: () => t("kartenvorschlag.redaktion.ablehnung.versionLang", { n: KARTE_VERSION_MAX }),
    },
};

/**
 * Der Zustand EINES Kartenvorschlags der Redaktion (WI-0275, ausgezogen für WI-0068 OPS-000093): Laden, die Blätter „Annehmen“ und „Ablehnen“, der Revisionsschutz, die Kartensperre. Zwei Orte zeigen ihn und
 * teilen sich damit dieselbe Annahme und Ablehnung, ohne zweite Implementierung: das Werkzeugfenster der Redaktion (`kartenvorschlag-redaktion-fenster.vue`, aus Community › Meldungen) und die dritte Spalte der
 * Medienverwaltung (Eingänge › Kartenvorschläge, `medien-vorschlag.vue`). Gezeichnet wird er von `kartenvorschlag-ansicht.vue`.
 *
 * - 🔴 **Gleichzeitig arbeiten:** Jeder Schritt trägt die Revision, die diese Seite sah. Ein anderer Stand sagt „Inzwischen geändert“ und lädt neu; die Eingabe bleibt stehen, nichts wird still überschrieben.
 * - 🔴 **Annehmen legt eine Karte an** und ist eine Handlung der Schreibklasse `map`: Kartensperre (423) und ein laufender Import (503) sagen es im Blatt und lassen die Eingabe stehen.
 * - Nach jedem Schritt und bei einem Konflikt meldet `redaktion.geaendert()`, damit jede Liste neu lädt (die Community-Liste, die der Medienverwaltung, die Zahl an der Schiene).
 * - `fliegen`: Das Werkzeugfenster lässt die Karte beim ersten Laden zum Ort fliegen; die Medienverwaltung nicht (die Karte ruht hinter dem Fenster), dort bleibt ⊕.
 */
export interface AnsichtOptionen {
    /** Die öffentliche Kennung des Vorschlags; leer: keiner gewählt. */
    id: () => string;
    rechte: () => readonly string[];
    /** Ist die Ansicht zu sehen? Ein versenktes Fenster lässt die Karte nicht fliegen. */
    sichtbar: () => boolean;
    fliegen: boolean;
    /** Der Titel aus der Fensterverwaltung, solange der Vorschlag nicht geladen ist. */
    vorlaeufigerTitel?: () => string;
}

export type AnsichtStand =
    | { readonly art: "laedt" }
    | { readonly art: "fehler"; readonly key: MessageKey }
    | { readonly art: "da"; readonly detail: KartenvorschlagDetail };

export type AnsichtBlatt = "annehmen" | "ablehnen";
export type AnnahmeWeg = "neu" | "version";

function baueAnsicht(optionen: AnsichtOptionen) {
    const id = computed(() => optionen.id());
    const stand = shallowRef<AnsichtStand>({ art: "laedt" });
    const detail = computed(() => (stand.value.art === "da" ? stand.value.detail : undefined));
    const meldung = shallowRef<{ readonly key: MessageKey; readonly ton: "warnung" | "gefahr" } | undefined>(undefined);
    const medienErlaubt = computed(() => optionen.rechte().includes("view_media_private"));
    let lauf = 0;

    /** Der Bezug im Format der Anbindung (`VorgangBezug`): der Ort als Objekt, damit die Karte ihn wählt und anfliegt. */
    const ortBezug = computed((): VorgangBezug | undefined => {
        const vorschlag = detail.value;
        if (vorschlag?.ort === null || vorschlag?.ort === undefined) return undefined;
        return {
            art: "objekt",
            objektArt: "place",
            objektId: vorschlag.ort.id,
            name: vorschlag.ort.name,
            typ: vorschlag.ortArt,
            lage: vorschlag.ortLage,
            vorschlagLage: null,
            naechsterOrt: null,
        };
    });

    /** Lädt den Vorschlag neu. `fliegen`: Beim ersten Laden fliegt die Karte zum Ort (wenn die Ansicht es will), danach nur auf ⊕. */
    async function lade(fliegen = false): Promise<boolean> {
        const mein = ++lauf;
        const zu = id.value;
        if (zu === "") return false;
        try {
            const antwort = await ladeVorschlag(zu);
            if (mein !== lauf || zu !== id.value) return false;
            stand.value = { art: "da", detail: antwort };
            const bezug = ortBezug.value;
            if (fliegen && optionen.fliegen && optionen.sichtbar() && bezug !== undefined) redaktion.zeige(bezug);
            return true;
        } catch (fehler) {
            if (mein !== lauf) return false;
            const key = REDAKTION_FEHLER_SATZ[redaktionFehler(fehler)];
            // Ein veralteter Stand bleibt stehen (nichts verschwindet, nur weil das Netz fehlt); ohne ihn steht der Fehler da.
            if (stand.value.art !== "da") stand.value = { art: "fehler", key };
            else meldung.value = { key, ton: "gefahr" };
            return false;
        }
    }

    /** Der Titel für den Kopf: der geladene Vorschlag („K-1047 Titel“), bis dahin der der Fensterverwaltung. */
    const kopfTitel = computed(() => {
        const vorschlag = detail.value;
        return vorschlag === undefined
            ? (optionen.vorlaeufigerTitel?.() ?? "")
            : `${vorschlag.nummer} ${vorschlag.titel}`;
    });

    // --- Blätter -----------------------------------------------------------------------------------------------------------

    const blatt = shallowRef<AnsichtBlatt | undefined>(undefined);
    const grund = ref("");
    const ortWahl = shallowRef<OrtWahl | null>(null);
    const sendet = ref(false);
    /** Der Satz im Blatt, warum der Schritt nicht ging: der genaue Grund des Servers in den Sätzen des Fensters, sonst der allgemeine. */
    const blattFehler = shallowRef<string | undefined>(undefined);
    /** Das Element des Blatts: Die Ansicht setzt es, damit der Fokus und das Rollen dorthin gehen. */
    const blattWurzel = shallowRef<HTMLElement | null>(null);
    const sperrId = useId();
    const ansicht = ref<number | null>(null);
    /** Das Bild lädt nicht (ein Notaus hat die Datei genommen): Dann steht der Platzhalter da, kein zerbrochenes Bild. */
    const bildFehlt = ref(false);

    // --- „Neuer Eintrag“ oder „Weitere Version eines Eintrags“ (WI-0287 Stufe 2) ---
    const annahmeWeg = ref<AnnahmeWeg>("neu");
    const zielFehlt = ref(false);
    const annahmeWegModell = computed({
        get: (): string => annahmeWeg.value,
        set: (neu: string) => {
            annahmeWeg.value = neu === "version" ? "version" : "neu";
            zielFehlt.value = false;
            blattFehler.value = undefined;
        },
    });
    const annahmeWahl = computed(() => [
        { value: "neu", label: t("kartenvorschlag.redaktion.blatt.wegNeu") },
        { value: "version", label: t("kartenvorschlag.redaktion.blatt.wegVersion") },
    ]);
    const annahmeZiel = shallowRef<MamKarteZeile | undefined>(undefined);
    const annahmeVersion = ref("");
    const versionId = useId();
    const medienClient = createMedienClient();
    /** Ohne Suchwort die Namensvettern des Orts, sonst des Titels (Entwurf `zeichneZielTreffer`). */
    const annahmeWort = computed(() => erstesWort(detail.value?.ort?.name ?? detail.value?.titel ?? ""));
    // Ein neu gewähltes Ziel nimmt den Satz eines früheren Fehlers weg; das Zurücksetzen nach „stillgelegt“ lässt ihn stehen.
    watch(annahmeZiel, (neu) => {
        zielFehlt.value = false;
        if (neu !== undefined) blattFehler.value = undefined;
    });

    function zuruecksetzen(): void {
        lauf += 1;
        stand.value = { art: "laedt" };
        meldung.value = undefined;
        blatt.value = undefined;
        grund.value = "";
        ortWahl.value = null;
        blattFehler.value = undefined;
        sendet.value = false;
        ansicht.value = null;
        bildFehlt.value = false;
        annahmeWeg.value = "neu";
        annahmeZiel.value = undefined;
        annahmeVersion.value = "";
        zielFehlt.value = false;
    }
    // Ein anderer Vorschlag in derselben Ansicht: Zustand weg, neu laden. Ohne Kennung (nichts gewählt) bleibt die Ansicht leer.
    watch(
        id,
        () => {
            zuruecksetzen();
            if (id.value !== "") void lade(true);
        },
        { immediate: true },
    );

    async function oeffneBlatt(art: AnsichtBlatt): Promise<void> {
        blattFehler.value = undefined;
        meldung.value = undefined;
        if (art === "annehmen") {
            ortWahl.value = detail.value?.ort ?? null;
            annahmeWeg.value = "neu";
            annahmeZiel.value = undefined;
            annahmeVersion.value = "";
            zielFehlt.value = false;
        }
        blatt.value = art;
        await nextTick();
        blattWurzel.value?.scrollIntoView({ block: "nearest" });
        blattWurzel.value?.querySelector<HTMLElement>("textarea, input, button")?.focus({ preventScroll: true });
    }
    const schliesseBlatt = (): void => {
        blatt.value = undefined;
        blattFehler.value = undefined;
    };

    function escBlatt(event: KeyboardEvent): void {
        if (event.key !== "Escape") return;
        // Esc bricht das Blatt ab, nicht das ganze Fenster.
        event.preventDefault();
        event.stopPropagation();
        if (!sendet.value) schliesseBlatt();
    }

    /** Führt einen Schritt aus und lädt danach neu. Ein veralteter Stand oder ein Übergang, der nicht mehr geht, laden neu und sagen es; sonst steht der Fehler im Blatt und die Eingabe bleibt. */
    async function tue(schritt: () => Promise<unknown>): Promise<boolean> {
        if (sendet.value) return false;
        sendet.value = true;
        meldung.value = undefined;
        blattFehler.value = undefined;
        try {
            await schritt();
        } catch (fehler) {
            const art = schrittFehler(fehler);
            const key = SCHRITT_SATZ[art];
            if (art === "konflikt" || art === "uebergang") {
                meldung.value = { key, ton: "warnung" };
                schliesseBlatt();
                await lade();
                redaktion.geaendert();
            } else {
                // Der gewählte Eintrag nimmt nichts mehr an: Die Wahl geht zurück an die Suche, der Satz bleibt stehen.
                if (art === "ziel") annahmeZiel.value = undefined;
                blattFehler.value = genauerGrund(fehler, SCHRITT_ABLEHNUNG) ?? t(key);
            }
            sendet.value = false;
            return false;
        }
        schliesseBlatt();
        grund.value = "";
        await lade();
        redaktion.geaendert();
        sendet.value = false;
        return true;
    }

    const revision = (): number => detail.value?.revision ?? 1;
    async function nimmAn(): Promise<boolean> {
        if (annahmeWeg.value === "neu") {
            return tue(() => annehme(id.value, revision(), { ort: ortWahl.value?.id ?? null }));
        }
        const ziel = annahmeZiel.value;
        if (ziel === undefined) {
            zielFehlt.value = true;
            return false;
        }
        const version = detail.value?.weg === "datei" ? annahmeVersion.value.trim() : "";
        return tue(() => annehme(id.value, revision(), { ziel: ziel.id, version: version === "" ? null : version }));
    }
    const lehneDenAb = (): Promise<boolean> => tue(() => lehneAb(id.value, revision(), grund.value));

    function zeige(): void {
        const bezug = ortBezug.value;
        if (bezug !== undefined) redaktion.zeige(bezug);
    }

    // --- Was steht da ------------------------------------------------------------------------------------------------------

    const fakten = computed(() => (detail.value === undefined ? undefined : faktenVon(detail.value)));
    const folgen = computed(() => (detail.value === undefined ? undefined : folgenVon(detail.value)));
    const verlauf = computed(() => (detail.value === undefined ? [] : verlaufVon(detail.value)));
    const fuss = computed(() => (detail.value === undefined ? undefined : fussVon(detail.value)));
    const istPdf = computed(() => detail.value?.dateiTyp === "application/pdf");

    /** Die eine Vorschau groß: das Bild der Datei, bei einem PDF Seite 1. */
    const bilder = computed(() => {
        const vorschlag = detail.value;
        if (vorschlag?.vorschau === null || vorschlag?.vorschau === undefined || bildFehlt.value) return [];
        const seite = istPdf.value ? ` · ${t("kartenvorschlag.redaktion.vorschau.seite")}` : "";
        return [{ url: vorschlag.vorschau, titel: `${vorschlag.nummer} ${vorschlag.titel}${seite}` }];
    });

    /** Was statt der Vorschau dasteht, solange keine da ist. */
    const platzhalter = computed(() => {
        const vorschlag = detail.value;
        if (vorschlag === undefined || (vorschlag.vorschau !== null && !bildFehlt.value)) return "";
        if (vorschlag.dateiGeloeschtAm !== undefined) return t("kartenvorschlag.redaktion.platzhalter.geloescht");
        if (vorschlag.technik === null) return t("kartenvorschlag.redaktion.platzhalter.keineDatei");
        if (vorschlag.technik === "pending") return t("kartenvorschlag.redaktion.platzhalter.pruefung");
        if (vorschlag.technik === "ok") return t("kartenvorschlag.redaktion.platzhalter.ohne");
        return t("kartenvorschlag.redaktion.platzhalter.defekt", { grund: technikName(vorschlag.technik) });
    });

    // `reactive` entpackt die Refs: Die Ansicht liest `z.detail`, schreibt `z.grund` und bindet `v-model="z.ortWahl"`, als wären es Felder.
    return reactive({
        id,
        stand,
        detail,
        meldung,
        medienErlaubt,
        kopfTitel,
        blatt,
        grund,
        ortWahl,
        sendet,
        blattFehler,
        blattWurzel,
        sperrId,
        ansicht,
        bildFehlt,
        annahmeWeg,
        annahmeWegModell,
        annahmeWahl,
        annahmeZiel,
        annahmeVersion,
        zielFehlt,
        versionId,
        medienClient,
        annahmeWort,
        fakten,
        folgen,
        verlauf,
        fuss,
        istPdf,
        bilder,
        platzhalter,
        lade,
        oeffneBlatt,
        schliesseBlatt,
        escBlatt,
        nimmAn,
        lehneDenAb,
        zeige,
    });
}

export type AnsichtZustand = ReturnType<typeof baueAnsicht>;

/** Der Zustand eines Vorschlags für eine Ansicht; muss in `setup` aufgerufen werden (er legt Beobachter an). */
export const erzeugeAnsicht = (optionen: AnsichtOptionen): AnsichtZustand => baueAnsicht(optionen);
