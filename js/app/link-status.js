// Linkchecker: the reader-facing marker for one link's reachability (Spec §1.8).
//
// The module knows nothing about adventures or maps -- it turns a state string into markup, nothing else.
// The state travels inside the payload that carries the link (adventures.php / citymaps.php), or can be
// fetched for arbitrary hashes via GET api/app/link-status.php.
//
// Three visible states (Spec §1.3) -- "unchecked" is shown rather than hidden, on the owner's explicit
// call: a link nobody has verified yet must not look the same as one we know is fine.
//   online    -> "(online)"                 green; the last check was a 2xx
//   dead      -> "(nicht mehr erreichbar)"  grey; a definitive 404/410/403/401, or three failures in a row
//   unchecked -> "(noch nicht geprüft)"     grey; registered but never successfully judged
//
// Anything else (empty/unknown) renders nothing -- that is not a state, it is missing data.
//
// A dead link stays clickable (struck through, greyed): our cache may be wrong, and the reader should be
// able to try anyway. Returns a leading-space string so it appends directly after a link.

function avesmapsLinkStatusMarkup(state) {
	var normalized = String(state == null ? "" : state).trim();
	if (normalized === "online") {
		return ' <span class="link-status link-status--online">'
			+ tr("linkStatus.online", "(online)") + '</span>';
	}
	if (normalized === "dead") {
		return ' <span class="link-status link-status--dead">'
			+ tr("linkStatus.dead", "(nicht mehr erreichbar)") + '</span>';
	}
	if (normalized === "unchecked") {
		return ' <span class="link-status link-status--unchecked">'
			+ tr("linkStatus.unchecked", "(noch nicht geprüft)") + '</span>';
	}
	return "";
}

// The class a link itself carries so a dead one reads as dead (struck through + muted) while staying
// clickable. Returns "" for every other state, so it can be concatenated into a class attribute unguarded.
function avesmapsLinkStatusLinkClass(state) {
	return String(state == null ? "" : state).trim() === "dead" ? " link-status-dead-target" : "";
}
