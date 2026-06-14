/*
 * English override strings for the ?lang=en overlay (v1: planner core).
 * Keyed by stable i18n key; German stays the inline / tr() default elsewhere.
 * Add entries here as coverage grows. Domain content is never keyed.
 */
window.AVESMAPS_I18N_EN = {
	// --- planner: static chrome (data-i18n) ---
	"planner.search": "Search",
	"planner.toggle": "Route planner",
	"planner.route.fastest": "Fastest route",
	"planner.route.shortest": "Shortest route",
	"planner.minimizeTransfers": "Minimize transfers",
	"planner.rests": "Rest periods",
	"planner.restHoursSuffix": "hours per day",
	"planner.overview.default": "Waypoints and travel time are shown here.",

	// --- planner: transport section (data-i18n; the custom combobox mirrors the
	//     native <option> text, so translating the options covers it too) ---
	"planner.transport.heading": "Means of transport",
	"planner.transport.filter.land": "Land",
	"planner.transport.filter.river": "River",
	"planner.transport.filter.sea": "Sea",
	"planner.transport.land.aria": "Land transport",
	"planner.transport.river.aria": "River transport",
	"planner.transport.sea.aria": "Sea transport",
	"planner.transport.opt.caravan": "Caravan (3.5 km/h)",
	"planner.transport.opt.groupFoot": "Group on foot (4 km/h)",
	"planner.transport.opt.lightWalker": "On foot, light luggage (5 km/h)",
	"planner.transport.opt.horseCarriage": "Horse carriage (5.5 km/h)",
	"planner.transport.opt.groupHorse": "Group on horseback (6.5 km/h)",
	"planner.transport.opt.lightRider": "Rider, light luggage (8 km/h)",
	"planner.transport.opt.riverSailer": "River sailer",
	"planner.transport.opt.riverBarge": "River barge",
	"planner.transport.opt.cargoShip": "Cargo sailer",
	"planner.transport.opt.fastShip": "Fast sailer",
	"planner.transport.opt.galley": "Galley",

	// --- planner: dynamic overview/summary (tr) ---
	"planner.overview.calculating": "Calculating route...",
	"planner.journey.prefix": "The journey",
	"planner.journey.from": "from",
	"planner.journey.to": "to",
	"planner.journey.via": "via",
	"planner.leg.offroad": "Rough terrain",
	"planner.leg.via": "via",
	"planner.leg.from": "from",
	"planner.leg.to": "to",
	"planner.leg.in": "in",
	"planner.summary.distance": "Distance",
	"planner.summary.airDistance": "As the dragon flies",
	"planner.summary.travelTime": "Travel time",
	"planner.summary.restTime": "Rest time",
	"planner.summary.totalTime": "Total time",
	"planner.shareRoute": "Copy link for this route",
	"planner.unit.miles": "miles",
	"planner.unit.hours": "hours",
	"planner.unit.days": "days",

	// --- map context menu (public actions) ---
	"ctxmenu.sharePin": "Mark and share this spot",
	"ctxmenu.shareMapLink": "🔗 Copy link to this route",
	"ctxmenu.reportLocation": "Report here...",
	"ctxmenu.search": "Search",
	"ctxmenu.findNearest": "Find nearest location",
	"ctxmenu.measureDistance": "Measure distance",
	"ctxmenu.clearDistance": "Clear distance measurement",

	// --- view-mode switcher (custom combobox mirrors the option text) ---
	"view.mode.label": "View mode",
	"view.mode.aria": "View mode",
	"view.mode.none": "Map only",
	"view.mode.political": "Political",
	"view.mode.standard": "Standard",
	"view.mode.powerlines": "Ley lines",

	// --- spotlight search ---
	"spotlight.title": "Search",
	"spotlight.placeholder": "Search the map",
	"spotlight.resultsAria": "Search results",

	// --- toasts: find-nearest + distance measurement ---
	"toast.findNearest.none": "No location found.",
	"toast.findNearest.openFailed": "The nearest location could not be opened.",
	"toast.measure.startSet": "Start point set. Now click the second point.",
	"toast.measure.cleared": "Distance measurement cleared.",
};
