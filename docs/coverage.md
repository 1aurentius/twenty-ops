# Coverage matrix

What's mapped from Twenty's API surface into `twenty-ops`, with the testing
status of each command. Updated as PRs land. Columns:

- **Mapped** — `yes` (full surface) / `partial` (some operations) / `no`
- **Unit** — hermetic command tests (`test/unit/commands/*.test.ts`)
- **Integration** — real-GraphQL tests against the pinned stack (`test/integration/*.int.test.ts`)
- **Lifecycle** — multi-command flow in `test/e2e/lifecycle.test.ts`

A row that's not `yes ✓ ✓ ✓` fails the strict merge bar — see the
"Per-feature merge bar" section in the README.

## v0.1 commands (backfill in progress)

| Domain                        | Mapped  | Unit | Integration | Lifecycle |
|-------------------------------|---------|------|-------------|-----------|
| `remote` (config CRUD)        | yes     | ✓    | n/a         | n/a       |
| `whoami`                      | yes     | ✓    | ✓           |           |
| `view` (CRUD)                 | yes     | ✓    | ✓           | ✓         |
| `view set-fields`             | yes     | ✓    | ✓           |           |
| `view set-filters`            | yes     | ✓    | ✓           |           |
| `view set-sorts`              | yes     | ✓    | ✓           |           |
| `nav` (CRUD)                  | yes     | ✓    | ✓           | ✓         |
| `workflow` (record CRUD)      | yes     | ✓    | ✓           | ✓         |
| `workflow set-trigger`        | yes     | ✓    | ✓           | ✓         |
| `workflow versions/runs`      | yes     | ✓    |             |           |
| `doctor` (self-check)         | yes     | ✓    | ✓           | n/a       |
| `record` (CRUD + bulk-upsert) | yes     | ✓    | ✓           | ✓         |
| `object` (CRUD)               | yes     | ✓    | ✓           |           |
| `field` (CRUD)                | yes     | ✓    | ✓           |           |
| `api-key` (CRUD + rotate)     | yes     | ✓    | ✓           |           |
| `webhook` (CRUD)              | yes     | ✓    | ✓           |           |
| `settings get` (read)         | yes     | ✓    | ✓           | n/a       |
| `role` (CRUD)                 | yes     | ✓    | ✓           |           |
| **Framework: schema drift**   | n/a     | ✓    | ✓           | n/a       |
| **Framework: resolveRemote**  | n/a     | ✓    | n/a         | n/a       |
| **Framework: seed automation**| n/a     | n/a  | ✓ (verified) | n/a      |

## Not yet mapped (sequenced via the v0.2+ plan)

| Domain                              | API status | Phase |
|-------------------------------------|------------|-------|
| Settings (write) `updateWorkspace`  | Stable mutation             | 5     |
| Members + roles + permissions       | Stable, complex             | 5     |
| Workflow steps + activation         | Blocked on Twenty image     | 6     |
| AI agents, page layouts, marketplace, SSO | Stable but lower priority | stretch |
