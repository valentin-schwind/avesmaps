import { inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, type Ref, type ShallowRef } from "vue";
import { ESCAPE_CASCADE_KEY } from "../keyboard/escape-cascade";
import { menueLageBegrenzt, menueSeite } from "./avm-menueknopf";

/**
 * Das Blatt hinter einem Knopf (Filterknopf, Betreiber 2026-10-11): öffnen, an den Knopf legen, schließen. Was `avm-menueknopf.vue`,
 * der Filter der Ortsliste und der Trichter der Medienverwaltung je für sich tun, steht hier einmal; der Menüknopf kann es übernehmen.
 *
 * - **Wohin:** in das offene `<dialog>`, in dem der Knopf steht, sonst an `body`. Ein modales Fenster liegt in der obersten Ebene;
 *   ein Blatt außerhalb wäre darunter und träge (Medienverwaltung). An `body` schneidet kein `overflow: hidden` es ab (Infopanel).
 * - **Wo:** unter dem Knopf, reicht der Platz nicht, darüber; links im Fenster linksbündig, rechts rechtsbündig (Betreiber
 *   2026-10-10, `menueSeite`), nie über den Rand. Passt es auf keiner Seite, geht es auf der größeren auf und wird auf deren Platz
 *   begrenzt (`menueLageBegrenzt`, `lage.hoehe`); es rollt dann in sich. Abstand zum Knopf `space-2` (4 px), zum Rand `space-6` (8 px).
 * - **Zu:** Esc (das Blatt selbst, sonst Stufe „menus“ der Kaskade), ein Klick daneben, ein Bildlauf der Seite (nicht einer IM Blatt)
 *   und eine neue Fenstergröße; ein Blatt, das stehen bliebe, zeigte auf nichts mehr. Esc gibt den Fokus an den Knopf zurück.
 */
const ABSTAND = 4;
const RAND = 8;

export interface MenueBlatt {
    offen: Ref<boolean>;
    lage: Ref<{ top: number; left: number; hoehe: number | undefined }>;
    /** Das Ziel des `Teleport`. */
    ziel: ShallowRef<HTMLElement | "body">;
    umschalten: () => void;
    schliessen: (zurueck: boolean) => void;
}

export function useMenueBlatt(
    knopf: Readonly<ShallowRef<HTMLElement | null>>,
    blatt: Readonly<ShallowRef<HTMLElement | null>>,
    /** Wohin der Fokus beim Öffnen geht: die aktive Wahl, sonst der erste Eintrag. */
    fokus: () => void,
): MenueBlatt {
    const offen = ref(false);
    const lage = ref<{ top: number; left: number; hoehe: number | undefined }>({ top: 0, left: 0, hoehe: undefined });
    const ziel = shallowRef<HTMLElement | "body">("body");

    async function oeffnen(): Promise<void> {
        if (offen.value) return;
        ziel.value = knopf.value?.closest<HTMLElement>("dialog[open]") ?? "body";
        offen.value = true;
        listen(true);
        await nextTick();
        const box = knopf.value?.getBoundingClientRect();
        const masse = blatt.value?.getBoundingClientRect();
        if (box && masse) {
            const bereich = knopf.value?.closest("dialog")?.getBoundingClientRect() ?? {
                left: 0,
                width: globalThis.innerWidth,
            };
            const fenster = { width: globalThis.innerWidth, height: globalThis.innerHeight };
            lage.value = menueLageBegrenzt(box, masse, fenster, ABSTAND, RAND, menueSeite(box, bereich));
            await nextTick();
        }
        fokus();
    }

    function schliessen(zurueck: boolean): void {
        if (!offen.value) return;
        offen.value = false;
        listen(false);
        if (zurueck) knopf.value?.focus();
    }

    function umschalten(): void {
        if (offen.value) schliessen(false);
        else void oeffnen();
    }

    function onDraussen(event: PointerEvent): void {
        const ziel = event.target as Node;
        if (knopf.value?.contains(ziel) || blatt.value?.contains(ziel)) return;
        schliessen(false);
    }

    function onVerschoben(event: Event): void {
        if (blatt.value?.contains(event.target as Node)) return;
        schliessen(false);
    }
    const onGroesse = (): void => schliessen(false);

    function listen(an: boolean): void {
        if (an) {
            document.addEventListener("pointerdown", onDraussen, true);
            document.addEventListener("scroll", onVerschoben, true);
            globalThis.addEventListener("resize", onGroesse);
        } else {
            document.removeEventListener("pointerdown", onDraussen, true);
            document.removeEventListener("scroll", onVerschoben, true);
            globalThis.removeEventListener("resize", onGroesse);
        }
    }

    const kaskade = inject(ESCAPE_CASCADE_KEY, undefined);
    let abmelden: (() => void) | undefined;
    onMounted(() => {
        abmelden = kaskade?.register("menus", () => {
            if (!offen.value) return false;
            schliessen(true);
            return true;
        });
    });
    onBeforeUnmount(() => {
        listen(false);
        abmelden?.();
    });

    return { offen, lage, ziel, umschalten, schliessen };
}
