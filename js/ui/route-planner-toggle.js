function getRoutePlannerPanelWidth() {
    const searchElement = document.getElementById("search");
    if (!searchElement) {
        return 350;
    }

    return Math.round(searchElement.getBoundingClientRect().width) || 350;
}

function normalizeHardcodedMapContextMenuIcons() {
    const leadingIconPattern = /^([\p{Emoji_Presentation}\p{Extended_Pictographic}]\uFE0F?)\s+/u;
    document.querySelectorAll("#map-context-menu .map-context-menu__item").forEach((buttonElement) => {
        if (buttonElement.querySelector(".map-context-menu__icon")) {
            return;
        }

        const text = buttonElement.textContent.replace(/\s+/g, " ").trim();
        const match = text.match(leadingIconPattern);
        if (!match) {
            return;
        }

        const icon = match[1];
        const label = text.slice(match[0].length).trim();
        buttonElement.textContent = "";

        const iconElement = document.createElement("span");
        iconElement.className = "map-context-menu__icon";
        iconElement.setAttribute("aria-hidden", "true");
        iconElement.textContent = icon;

        const labelElement = document.createElement("span");
        labelElement.className = "map-context-menu__label";
        labelElement.textContent = label;

        buttonElement.append(iconElement, labelElement);
    });
}

function normalizeRouteDistanceLabels() {
    const overviewElement = document.getElementById("overview");
    if (!overviewElement) {
        return;
    }

    const replaceLabel = () => {
        overviewElement.querySelectorAll(".route-plan-summary").forEach((summaryElement) => {
            summaryElement.childNodes.forEach((node) => {
                if (node.nodeType === Node.TEXT_NODE && node.textContent.includes("Luftlinie")) {
                    node.textContent = node.textContent.replaceAll("Luftlinie", "Drachenflug");
                }
            });
        });
    };

    replaceLabel();
    new MutationObserver(replaceLabel).observe(overviewElement, { childList: true, subtree: true });
}

function enableWaypointTouchSorting() {
    const waypointsElement = document.getElementById("waypoints");
    if (!waypointsElement || !window.jQuery || !jQuery.fn?.sortable) {
        return;
    }

    waypointsElement.addEventListener("touchstart", (event) => {
        const handle = event.target.closest(".waypoint-drag-handle");
        if (!handle || !waypointsElement.contains(handle)) {
            return;
        }

        const touch = event.changedTouches[0];
        if (!touch) {
            return;
        }

        const simulatedEvent = new MouseEvent("mousedown", {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: touch.clientX,
            clientY: touch.clientY,
            screenX: touch.screenX,
            screenY: touch.screenY,
            button: 0,
        });
        handle.dispatchEvent(simulatedEvent);
        event.preventDefault();
    }, { passive: false });

    ["touchmove", "touchend", "touchcancel"].forEach((eventName) => {
        document.addEventListener(eventName, (event) => {
            const touch = event.changedTouches[0];
            if (!touch) {
                return;
            }

            const mouseEventName = eventName === "touchmove" ? "mousemove" : "mouseup";
            document.dispatchEvent(new MouseEvent(mouseEventName, {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: touch.clientX,
                clientY: touch.clientY,
                screenX: touch.screenX,
                screenY: touch.screenY,
                button: 0,
            }));
        }, { passive: false });
    });
}

function enableBlankEditMapStyle() {
    const selectElement = document.getElementById("mapStyleSelect");
    const mapElement = document.getElementById("map");
    if (!selectElement || !mapElement || typeof map === "undefined") {
        return;
    }

    if (!selectElement.querySelector('option[value="none"]')) {
        const optionElement = document.createElement("option");
        optionElement.value = "none";
        optionElement.textContent = "None";
        selectElement.insertBefore(optionElement, selectElement.firstChild);
    }

    const originalSetMapStyle = typeof setMapStyle === "function" ? setMapStyle : null;

    window.setMapStyle = function setMapStyleWithBlankOption(mapStyle, options = {}) {
        if (mapStyle !== "none") {
            mapElement.style.backgroundColor = "";
            return originalSetMapStyle?.(mapStyle, options);
        }

        if (typeof baseTileLayer !== "undefined" && baseTileLayer) {
            map.removeLayer(baseTileLayer);
            baseTileLayer = null;
        }

        activeMapStyle = "none";
        mapElement.style.backgroundColor = "#dcdcdc"; // dezentes Grau statt Weiss als leerer Hintergrund
        selectElement.value = "none";

        if (options.persist) {
            try {
                window.localStorage?.setItem(EDIT_MODE_MAP_STYLE_STORAGE_KEY, "none");
            } catch (error) {
                console.warn("Mapstyle konnte nicht gespeichert werden:", error);
            }
            if (typeof syncPlannerStateToUrl === "function") {
                syncPlannerStateToUrl();
            }
        }
    };

    const requestedStyle = (typeof window.avesmapsSearchParams === "function" ? window.avesmapsSearchParams() : new URLSearchParams(window.location.search)).get("mapstyle");
    let storedStyle = "";
    try {
        storedStyle = window.localStorage?.getItem(EDIT_MODE_MAP_STYLE_STORAGE_KEY) || "";
    } catch (error) {
        console.warn("Mapstyle konnte nicht gelesen werden:", error);
    }

    // Im Frontend zaehlt NUR der ?mapstyle=none-Parameter; der localStorage-Restore bleibt Edit-only,
    // damit ein gespeicherter Edit-Zustand nicht ungewollt in die oeffentliche Ansicht durchschlaegt.
    if (requestedStyle === "none" || (typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE && storedStyle === "none")) {
        window.setMapStyle("none");
    }
}

normalizeHardcodedMapContextMenuIcons();
normalizeRouteDistanceLabels();
enableWaypointTouchSorting();
enableBlankEditMapStyle();

/**
 * Der EINE Weg, den Planer auf- und zuzufahren -- die Lasche und das Infopanel gehen beide hier
 * durch. Vorher stand die Bewegung nur im Klick-Zuhoerer, und ein zweiter Aufrufer haette sie
 * abschreiben muessen.
 * 💣 Der Riegel oben ist tragend, nicht bloss Sparsamkeit: am Telefon ruft dieser Weg beim AUFgehen
 * das Infopanel zum Einklappen, und dessen sync() ruft beim Aufgehen hierher zurueck. Ohne "ist
 * schon so -> nichts tun" waere das ein Ping-Pong. Einklappen loest deshalb NIE ein Aufklappen aus:
 * jede Richtung schliesst nur den anderen, sie oeffnet ihn nie.
 */
/**
 * Der Zustand des Planers wird an EINER Stelle festgehalten: in der Variablen, die das JS liest, und
 * in der Klasse, die das CSS liest. Am Telefon ist die Lasche seit dem 12.08.2026 ein Pfeil, und
 * seine RICHTUNG ist dieser Zustand (css/layout/map-layout.css) -- fehlt die Klasse, zeigt der Pfeil
 * verkehrt herum, und sonst sieht nichts falsch aus. Genau deshalb stehen beide hier zusammen und
 * nicht an den zwei Stellen, die den Planer zufahren.
 */
function markRoutePlannerCollapsed(collapsed) {
    isSearchPanelHidden = collapsed;
    document.documentElement.classList.toggle("avesmaps-planner-collapsed", collapsed);
    /**
     * 💣 Der OFFEN-Anker ist eine eigene Klasse, kein `:not(.avesmaps-planner-collapsed)`.
     * Zwei Klassen, aber weiterhin EINE Stelle -- und das ist der Punkt: bis diese Funktion das
     * erste Mal laeuft, traegt <html> KEINE der beiden. Eine `:not()`-Regel gaelte in diesem
     * Fenster als „offen" und blendete am Telefon den Knopfbund weg, bevor
     * collapseRoutePlannerOnPhone() ihn zurueckholt -- ein Flackern beim Laden, das nur auf
     * langsamen Geraeten auffaellt und dort jedes Mal.
     * Die Regel dazu steht in css/layout/map-layout.css (nur am Telefon).
     */
    document.documentElement.classList.toggle("avesmaps-planner-open", !collapsed);
}

function setRoutePlannerCollapsed(collapsed) {
    if (collapsed === isSearchPanelHidden) {
        return;
    }

    const panelWidth = getRoutePlannerPanelWidth();
    // 220ms = dieselbe Dauer wie die CSS-transform-Slides von Info-Panel + Editor (infopanel.css /
    // review-panel.css) -- damit fahren alle Panels einheitlich schnell aus/ein.
    $("#search").stop(true).animate({ left: collapsed ? `-${panelWidth}px` : "0px" }, 220);
    $("#toggle-button").stop(true).animate({ left: collapsed ? "0px" : `${panelWidth}px` }, 220);
    markRoutePlannerCollapsed(collapsed);

    // Am Telefon ist immer nur EIN Panel offen (Owner 11.08.2026, mit Foto: Infopanel lag ueber dem
    // Planer). Am Zeiger duerfen sie nebeneinander stehen -- dort ist Platz dafuer.
    if (!collapsed && typeof avesmapsIsPhoneViewport === "function" && avesmapsIsPhoneViewport()
        && typeof window.avesmapsInfopanelCollapse === "function") {
        window.avesmapsInfopanelCollapse();
    }
}

/** Gegenstueck fuer das Infopanel: es klappt den Planer ein, wenn es selbst aufgeht. */
window.avesmapsCollapseRoutePlanner = function () {
    setRoutePlannerCollapsed(true);
};

$("#toggle-button").off("click").on("click", () => {
    setRoutePlannerCollapsed(!isSearchPanelHidden);
});

// Auf dem Smartphone den Routenplaner standardmaessig eingeklappt starten (mehr Karte sichtbar;
// per "Routenplaner"-Lasche jederzeit aufklappbar).
(function collapseRoutePlannerOnPhone() {
    if (typeof avesmapsIsPhoneViewport !== "function" || !avesmapsIsPhoneViewport() || isSearchPanelHidden) {
        return;
    }
    const panelWidth = getRoutePlannerPanelWidth();
    $("#search").css("left", `-${panelWidth}px`);
    $("#toggle-button").css("left", "0px");
    markRoutePlannerCollapsed(true);
})();
