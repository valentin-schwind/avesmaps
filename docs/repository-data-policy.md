# Repository Data Policy

As of: 2026-05-25

This document defines which information, files and configurations may live in the Avesmaps GitHub repository and which may not. It complements the API restructuring plan and is especially relevant for the planned PHP/API folder structure.

## Principle

The GitHub repository may contain code, documentation, example configurations, schemas and non-secret map data. It must not contain production credentials, tokens, passwords, private sessions, database dumps with user data, or secret server details.

Anything required to reproduce the application may go into the repository, provided it contains no secrets or personal data.

Anything that exposes real server access, a real database, a production API key, or non-public user data must not go into the repository.

## May go into the repository

### Code

Allowed:

```text
HTML, CSS, JavaScript
PHP endpoints
PHP libraries
Python scripts
SQL schema files
GitHub Actions workflows
.htaccess rules
Smoke-test scripts
```

Code may also contain internal architecture, e.g. routing-graph construction, WikiSync logic or editor logic. The fact that code is used internally does not make it secret. It must, however, be organized so that internal PHP files are not directly reachable by URL in the deployment.

### Documentation

Allowed:

```text
docs/*.md
README.md
API contracts
Migration plans
Smoke-test descriptions
Architecture decisions
Example requests and example responses
```

Documentation may describe which endpoints exist, which methods and fields they expect, and which error codes can occur. It must not contain real tokens, passwords or private server paths.

### Example configurations

Allowed:

```text
config/api.config.example.php
.env.example
Example values such as example.org, localhost, replace-with-token
```

Example configurations must be clearly recognizable as examples. Placeholders must never be real credentials.

Allowed examples:

```php
'database' => [
    'host' => 'localhost',
    'name' => 'avesmaps',
    'user' => 'avesmaps_user',
    'password' => 'replace-with-password',
]
```

```text
AVESMAPS_IMPORT_API_TOKEN=replace-with-a-long-random-token
```

### SQL schemas

Allowed:

```text
api/_schema/mysql.sql
api/_schema/pgsql.sql
api/_schema/future.mysql.sql
```

Schemas may contain tables, indexes, constraints, example comments and empty seed structures.

Not allowed in schema files are production dumps with real users, real password hashes, real tokens, private reports or production audit logs.

### Public or editorially controlled map data

Allowed, provided it has been deliberately released:

```text
GeoJSON
SVG source data
static map data
place names
Wege
Regionen
political territories
Wiki URLs
non-secret routing data
```

This data is the core of the app. It may go into the repository if it is editorially controlled and contains no private user contributions or moderation notes.

### .htaccess

Allowed and desired:

```text
.htaccess
api/.htaccess
api/_internal/.htaccess
api/_schema/.htaccess
api/diagnostics/.htaccess
```

`.htaccess` is part of the deployed security architecture and belongs in the repository. Access denials for internal folders are especially important.

## Must not go into the repository

### Production secrets

Forbidden:

```text
api/config.local.php
.env
API tokens
Import tokens
Session secrets
Database passwords
FTP/SFTP credentials
SSH keys
OAuth client secrets
Google service-account keys
```

These values must live locally, server-side, or in GitHub Secrets.

### Production server details

Do not belong in the repository:

```text
production database name, unless deliberately public
production DB user
production DB host, unless deliberately public
absolute internal server paths
hosting control-panel credentials
SFTP host/user/password
```

GitHub Actions may reference secret names, but not their values.

Allowed:

```yaml
AVESMAPS_HOST: ${{ secrets.AVESMAPS_HOST }}
```

Not allowed:

```yaml
AVESMAPS_HOST: real.server.example
AVESMAPS_PASSWORD: real-password
```

### Personal or moderation data

Do not belong in the repository:

```text
real user reports from location_reports
email addresses of reporters
IP addresses
admin/editor user data
session data
audit logs from production
moderation notes
private comments from review processes
```

If example reports are needed, they must be synthetic and clearly recognizable as demo data.

### Production database dumps

Not allowed:

```text
full SQL dumps from production
dumps with users
dumps with tokens
dumps with audit logs
dumps with unreviewed community reports
```

Only empty schemas or deliberately anonymized, small test fixtures are allowed.

## Should live in GitHub Secrets

```text
AVESMAPS_HOST
AVESMAPS_PORT
AVESMAPS_USER
AVESMAPS_PASSWORD
AVESMAPS_REMOTE_PATH
```

Further possible secrets:

```text
AVESMAPS_IMPORT_API_TOKEN
AVESMAPS_DB_PASSWORD
AVESMAPS_DB_USER
AVESMAPS_DB_HOST
AVESMAPS_DB_NAME
```

If these values are not needed for GitHub Actions, they stay exclusively on the server or locally.

## Should live locally or server-side

```text
api/config.local.php
api/.env
.env
map/google-sheets-credentials.json
map/google-sheets-token.json
```

These files must not be committed. The deploy workflow must not upload or overwrite them.

## Must be protected against web access

Even though code may live in the repository, not everything may be reachable on the web.

Hard protection via `.htaccess` for:

```text
api/_internal/
api/_schema/
api/diagnostics/
```

Minimal content:

```apache
<IfModule mod_authz_core.c>
    Require all denied
</IfModule>

<IfModule !mod_authz_core.c>
    Order allow,deny
    Deny from all
</IfModule>
```

Important: repository visibility and web reachability are different things. Internal code may live in the GitHub repo, but in the deployment it must not be directly executable or readable as a URL.

## API documentation and stability promise

Only endpoints deliberately intended as an external contract are documented as a stable developer API:

```text
POST /api/route/
GET  /api/locations/
```

Not automatically promised as an external developer API:

```text
/api/app/*
/api/edit/*
/api/import/*
/api/diagnostics/*
```

`api/app/*` may be reachable from the browser, but is primarily infrastructure for the Avesmaps app. These endpoints can be documented later, once they have been deliberately stabilized.

`api/edit/*` is protected and intended only for editor/review functions.

`api/import/*` is token-protected and intended for local import/moderation scripts.

`api/diagnostics/*` is not intended for public use.

## Checks before commits

Before API/deployment commits, check:

```text
1. Does the commit contain config.local.php, .env or real tokens?
2. Does the commit contain production database dumps?
3. Does the commit contain real user data, reports or audit logs?
4. Are new internal folders protected via .htaccess?
5. Does the documentation reference only placeholder values?
6. Do GitHub Actions stick to secret references instead of real values?
7. Are example responses anonymous or synthetic?
```

## Smoke test for access protection

After deployment, these URLs must not be publicly usable:

```text
GET /api/_internal/bootstrap.php
GET /api/_internal/auth.php
GET /api/_schema/mysql.sql
GET /api/diagnostics/political-schema.php
```

Expectation: `403 Forbidden` or another non-usable response. No PHP error output, no SQL content, no configuration details.

## Handling accidentally committed secrets

If a secret was accidentally committed:

1. Immediately consider the secret compromised.
2. Rotate the secret on the server/provider/GitHub.
3. Do not just revert the commit; otherwise the secret remains in the Git history.
4. Perform history cleanup only deliberately and in a targeted way.
5. Afterwards, repeat the deploy and access tests.

## Decision for the API restructuring

For the planned rework, this policy means:

- `_internal` and `_schema` may live in the repo.
- `_internal` and `_schema` must be blocked on the web.
- `config.local.php` stays outside the repo.
- `config/api.config.example.php` may stay in the repo.
- The Route and Locations API may be documented.
- App, Edit, Import and Diagnostics endpoints are clearly separated from the documented developer API.
