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
| `view set-groups`             | yes     | ✓    |             |           |
| `view set-field-groups`       | yes     | ✓    | ✓           |           |
| `view set-filter-groups`      | yes     | ✓    | ✓           |           |
| `nav` (CRUD)                  | yes     | ✓    | ✓           | ✓         |
| `workflow` (record CRUD)      | yes     | ✓    | ✓           | ✓         |
| `workflow set-trigger`        | yes     | ✓    | ✓           | ✓         |
| `workflow versions/runs`      | yes     | ✓    |             |           |
| `workflow trigger` (CRUD)     | yes     | ✓    | ✓           |           |
| `doctor` (self-check)         | yes     | ✓    | ✓           | n/a       |
| `record` (CRUD + bulk-upsert + merge) | yes | ✓ | ✓           | ✓         |
| `object` (CRUD)               | yes     | ✓    | ✓           |           |
| `field` (CRUD)                | yes     | ✓    | ✓           |           |
| `api-key` (CRUD + rotate)     | yes     | ✓    | ✓           |           |
| `webhook` (CRUD)              | yes     | ✓    | ✓           |           |
| `settings get` (read)         | yes     | ✓    | ✓           | n/a       |
| `settings update` (write)     | yes     | ✓    | ✓ (read + AUTH gate; mutations user-scoped) |  |
| `role` (CRUD)                 | yes     | ✓    | ✓           |           |
| `member` (CRUD + settings)    | yes     | ✓    | ✓           |           |
| `invitation` (list/send/resend/revoke) | yes  | ✓ | ✓ (read + AUTH gate; mutations user-scoped) |  |
| `permission` (show / set-* / apply)           | yes     | ✓ | ✓     |           |
| `logic-function` (CRUD + source + execute)    | yes     | ✓ | ✓     |           |
| **Framework: schema drift**   | n/a     | ✓    | ✓           | n/a       |
| **Framework: resolveRemote**  | n/a     | ✓    | n/a         | n/a       |
| **Framework: seed automation**| n/a     | n/a  | ✓ (verified) | n/a      |

## Not yet mapped

| Domain                              | API status | Phase |
|-------------------------------------|------------|-------|
| Workflow steps + activation         | Blocked on Twenty image     | v0.7+ |
| View widgets + page-layout widgets  | Stable; widgets live on page layouts | v0.7 |
| Page layouts + tabs + dashboards    | Stable, well-defined        | v0.7 |
| Connected accounts + channels       | OAuth-coupled creation      | v0.7+ |
| AI agents + skills + chat threads   | Stable, niche               | stretch |
| SSO + custom/public/emailing domains | Stable, enterprise-focused | stretch |
| Application registrations + marketplace | Stable, publishers only | stretch |
