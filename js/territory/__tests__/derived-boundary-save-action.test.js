const assert = require("assert");
const {
	avesmapsDerivedBoundarySaveAction,
	avesmapsDerivedBoundaryInnerFlagOverride,
} = require("../territory-derived-geometry-save-order.js");

// Bug #56: saving a territory in the Territoriumseditor did not recompute its outer boundary
// unless the editor had first toggled one of the boundary checkboxes. The save hook was gated
// by a single "dirty" flag that answered two different questions at once:
//   - may we DELETE the boundary?   -> yes, only after a deliberate un-tick (guard is load-bearing)
//   - should we RECOMPUTE it?       -> yes, on every save (this is what #56 asks for)
// These four cases pin that split. Merging them back reintroduces either #56 or the
// "Teufelskreis" it was originally guarding against.

// 1. Boundary enabled and the editor touched the boundary controls -> recompute.
assert.strictEqual(
	avesmapsDerivedBoundarySaveAction({ enabled: true, dirty: true }),
	"recompute",
	"enabled + touched must recompute"
);

// 2. Bug #56: boundary enabled, controls untouched (a plain colour/name/geometry save)
//    -> must STILL recompute. This case returned "none" before the fix.
assert.strictEqual(
	avesmapsDerivedBoundarySaveAction({ enabled: true, dirty: false }),
	"recompute",
	"#56: enabled must recompute even when no checkbox was clicked"
);

// 3. The editor deliberately unchecked "Außengrenzen darstellen" -> delete it.
assert.strictEqual(
	avesmapsDerivedBoundarySaveAction({ enabled: false, dirty: true }),
	"delete",
	"a deliberate un-tick must delete the boundary"
);

// 4. Load-bearing guard: the checkbox is off but nobody touched it. That happens when the
//    editor was opened over a leaf node, where the box is wrongly unchecked. Deleting here
//    would silently drop a boundary during an unrelated save -> do nothing.
assert.strictEqual(
	avesmapsDerivedBoundarySaveAction({ enabled: false, dirty: false }),
	"none",
	"an untouched unchecked box must NOT delete anything"
);

// 5. Defensive: missing/garbage input behaves like "off and untouched", i.e. it never destroys data.
assert.strictEqual(avesmapsDerivedBoundarySaveAction(), "none", "no argument must be inert");
assert.strictEqual(avesmapsDerivedBoundarySaveAction({}), "none", "empty options must be inert");
assert.strictEqual(
	avesmapsDerivedBoundarySaveAction({ enabled: "yes", dirty: 1 }),
	"none",
	"only real booleans count; truthy strings must not enable a write"
);

// --- inner-boundary flag override -------------------------------------------------------
// Now that every save recomputes, the save must NOT push the "Innengrenzen darstellen" checkbox
// down on every run. updateInnerBoundaryControl() force-unchecks that box for leaf and
// last-breadcrumb nodes, so on an untouched save it is not a mirror of the stored value -- passing
// it would clobber a stored "inner boundaries on" back to off. undefined = engine keeps what is
// stored (readExistingShowInnerBoundaries).

// 6. Untouched save: no explicit flag, whatever the checkbox happens to show.
assert.strictEqual(
	avesmapsDerivedBoundaryInnerFlagOverride({ touched: false, canShowInner: true, checked: false }),
	undefined,
	"an untouched save must not override the stored inner flag"
);
assert.strictEqual(
	avesmapsDerivedBoundaryInnerFlagOverride({ touched: false, canShowInner: true, checked: true }),
	undefined,
	"an untouched save must not override the stored inner flag, checked either"
);

// 7. The editor touched the controls -> the checkbox becomes authoritative, on and off.
assert.strictEqual(
	avesmapsDerivedBoundaryInnerFlagOverride({ touched: true, canShowInner: true, checked: true }),
	true,
	"a touched save passes the ticked checkbox down"
);
assert.strictEqual(
	avesmapsDerivedBoundaryInnerFlagOverride({ touched: true, canShowInner: true, checked: false }),
	false,
	"a touched save passes a deliberate un-tick down"
);

// 8. A node that cannot have inner boundaries at all reports false, never a stale true.
assert.strictEqual(
	avesmapsDerivedBoundaryInnerFlagOverride({ touched: true, canShowInner: false, checked: true }),
	false,
	"no inner boundaries possible => false even if the box is ticked"
);

// 9. Defensive: garbage input never produces an override.
assert.strictEqual(avesmapsDerivedBoundaryInnerFlagOverride(), undefined, "no argument => no override");
assert.strictEqual(avesmapsDerivedBoundaryInnerFlagOverride({}), undefined, "empty options => no override");

console.log("derived-boundary-save-action: ALL PASS");
