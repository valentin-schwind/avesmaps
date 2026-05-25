# Routing API Phase 1 Contract

## Goal

Phase 1 introduces the public routing API boundary without implementing server-side route calculation yet.

The endpoint should accept a normalized RouteRequest and return a stable JSON envelope. This lets the frontend and external callers rely on the API shape before the PHP route engine is implemented.

## Endpoint

```text
POST /api/route.php
Content-Type: application/json
Accept: application/json
```

Optional diagnostic GET behavior may be added, but route calculation requests must use POST.

## Phase 1 scope

Allowed in Phase 1:

- create `api/route.php`;
- parse JSON request body;
- validate request shape;
- normalize request values;
- return deterministic JSON success/error envelopes;
- include clear `not_implemented` response for valid requests;
- add small PHP helpers if needed;
- update `api/README.md` and `docs/routing-api-implementation-status.md`.

Not allowed in Phase 1:

- no route calculation;
- no SQL graph loading;
- no frontend switch to API;
- no JavaScript routing behavior change;
- no changes to client smoke baselines;
- no unrelated API or territory files.

## Request schema

Canonical request object:

```json
{
  "from": "Gareth",
  "to": "Tuzak",
  "via": [],
  "optimize": "fastest",
  "include_air_distance": true,
  "include_geometry": true,
  "include_steps": true,
  "include_rests": true,
  "rest_hours_per_day": 10,
  "minimize_transfers": false,
  "transports": {
    "land": "groupFoot",
    "river": "riverBoat",
    "sea": "sailingShip",
    "synthetic": "groupFoot"
  }
}
```

### Fields

| Field | Type | Required | Phase 1 behavior |
|---|---:|---:|---|
| `from` | string | yes | trim, non-empty |
| `to` | string | yes | trim, non-empty |
| `via` | array<string> | no | default `[]`, trim entries, remove empty values |
| `optimize` | string | no | `fastest` or `shortest`, default `fastest` |
| `include_air_distance` | bool | no | default `true` |
| `include_geometry` | bool | no | default `true` |
| `include_steps` | bool | no | default `true` |
| `include_rests` | bool | no | default `true` |
| `rest_hours_per_day` | number | no | default `10`, clamp or reject invalid values; recommended valid range `0` to `23.5` |
| `minimize_transfers` | bool | no | default `false` |
| `transports` | object | no | default object shown above |

### Transport values

Phase 1 should validate only the known option keys. It does not need to validate whether a transport is legal for a route segment because no route is calculated yet.

Initial accepted values should mirror the frontend option IDs:

Land:

- `caravan`
- `groupFoot`
- `lightWalker`
- `horseCarriage`
- `groupHorse`
- `lightRider`

River:

- use the exact current frontend option IDs from `#riverTransport`; Codex must inspect the current HTML/JS before implementing.

Sea:

- use the exact current frontend option IDs from `#seaTransport`; Codex must inspect the current HTML/JS before implementing.

Synthetic:

- same accepted values as land, default `groupFoot`.

If Codex cannot identify exact river/sea values confidently, Phase 1 may skip strict value validation for those two keys and only require strings. Document that decision explicitly.

## Success envelope

For a valid request in Phase 1, return HTTP `501 Not Implemented` with `ok: false` and a normalized request payload.

```json
{
  "ok": false,
  "error": {
    "code": "not_implemented",
    "message": "Server-side routing is not implemented yet."
  },
  "request": {
    "from": "Gareth",
    "to": "Tuzak",
    "via": [],
    "optimize": "fastest",
    "include_air_distance": true,
    "include_geometry": true,
    "include_steps": true,
    "include_rests": true,
    "rest_hours_per_day": 10,
    "minimize_transfers": false,
    "transports": {
      "land": "groupFoot",
      "river": "riverBoat",
      "sea": "sailingShip",
      "synthetic": "groupFoot"
    }
  }
}
```

Rationale: this confirms parsing and normalization while making it impossible to confuse Phase 1 with a real route result.

## Error envelope

All errors should be JSON.

```json
{
  "ok": false,
  "error": {
    "code": "invalid_request",
    "message": "Missing required field: from",
    "details": {
      "field": "from"
    }
  }
}
```

Recommended HTTP statuses:

| Condition | HTTP | Error code |
|---|---:|---|
| method is not POST | 405 | `method_not_allowed` |
| malformed JSON | 400 | `invalid_json` |
| missing/invalid required field | 400 | `invalid_request` |
| unsupported enum value | 400 | `invalid_request` |
| valid request but routing not implemented | 501 | `not_implemented` |
| uncaught server error | 500 | `server_error` |

## Future successful RouteResult schema

Phase 1 does not implement this response yet, but it should reserve this shape for later phases:

```json
{
  "ok": true,
  "request": {},
  "result": {
    "summary": {
      "distance": 1256.7,
      "air_distance": 808.0,
      "travel_hours": 163.0,
      "rest_hours": 0.0,
      "total_hours": 163.0,
      "transfers": 2
    },
    "steps": [
      {
        "type": "Flussweg",
        "transport": "riverBoat",
        "from": "Gareth",
        "to": "Perricum",
        "path_name": "Gardel/Darpat",
        "distance": 123.4,
        "travel_hours": 12.3,
        "rest_hours": 0.0,
        "segment_ids": [0, 1, 2]
      }
    ],
    "geometry": {
      "type": "FeatureCollection",
      "features": []
    }
  }
}
```

Field names should prefer snake_case in the API, while browser-internal JavaScript may continue using camelCase where already established.

## Manual Phase 1 tests

Use PowerShell examples after deployment or local PHP server setup.

Valid request should return `501` and normalized request:

```powershell
Invoke-WebRequest `
  -Method POST `
  -Uri "https://avesmaps.de/api/route.php" `
  -ContentType "application/json" `
  -Body '{"from":"Gareth","to":"Tuzak"}'
```

Malformed JSON should return `400`:

```powershell
Invoke-WebRequest `
  -Method POST `
  -Uri "https://avesmaps.de/api/route.php" `
  -ContentType "application/json" `
  -Body '{"from":"Gareth",'
```

Wrong method should return `405`:

```powershell
Invoke-WebRequest `
  -Method GET `
  -Uri "https://avesmaps.de/api/route.php"
```

Missing `from` should return `400`:

```powershell
Invoke-WebRequest `
  -Method POST `
  -Uri "https://avesmaps.de/api/route.php" `
  -ContentType "application/json" `
  -Body '{"to":"Tuzak"}'
```

## Acceptance criteria

Phase 1 is accepted when:

- `api/route.php` exists;
- PHP syntax check passes;
- all responses are JSON;
- valid requests return normalized request plus `not_implemented`;
- invalid requests return deterministic JSON errors;
- no frontend routing behavior changes;
- no full routing smoke is needed;
- `api/README.md` and implementation status docs are updated.
