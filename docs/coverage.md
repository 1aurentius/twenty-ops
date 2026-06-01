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
| `page-layout` (CRUD + reset)                  | yes     | ✓ | ✓     |           |
| `page-layout tab` (CRUD + reset)              | yes     | ✓ | ✓     |           |
| `page-layout widget` (CRUD + reset)           | yes     | ✓ | ✓ (server-gated on configuration type) |  |
| `page-layout widget configure-view/-fields`   | yes     | ✓ |        |           |
| `dashboard` (CRUD + restore)                  | yes     | ✓ | ✓     |           |
| `skill` (CRUD + activate/deactivate)          | yes     | ✓ | ✓     |           |
| `agent` (CRUD + role binding + turns)         | yes     | ✓ | ✓ (server-gated on AI model availability) |  |
| `chat` (thread management)                    | yes     | ✓ | ✓ (AUTH-gated; user context required) |  |
| `connected-account` (CRUD + my + restore)     | yes     | ✓ | ✓ (`my` AUTH-gates; OAuth-coupled create) | |
| `message-channel` (CRUD + restore)            | yes     | ✓ | ✓ (read paths; create OAuth-coupled) | |
| `calendar-channel` (CRUD + restore)           | yes     | ✓ | ✓ (read paths; create OAuth-coupled) | |
| `blocklist` (CRUD + restore)                  | yes     | ✓ | ✓ (read paths; create AUTH-gated server-side) | |
| **Framework: schema drift**   | n/a     | ✓    | ✓           | n/a       |
| **Framework: resolveRemote**  | n/a     | ✓    | n/a         | n/a       |
| **Framework: seed automation**| n/a     | n/a  | ✓ (verified) | n/a      |

## Not yet mapped

| Domain                              | API status | Phase |
|-------------------------------------|------------|-------|
| Workflow steps + activation         | Blocked on Twenty image     | v1.0+ |
| `chat send` + `uploadAiChatFile`    | Streaming + multipart        | v1.0 |
| SSO + custom/public/emailing domains | Stable, enterprise-focused | v1.0 |
| Application registrations + marketplace | Stable, publishers only | stretch |
| Front components + command menu items | Stable, UI extensibility | stretch |
| `page-layout sync --file`           | Uses updatePageLayoutWithTabsAndWidgets | v1.0 |
| Message folders + threads + participants | Read-only, derived | stretch |
| Declarative `set-*` for blocklists  | Reconcile UX                | stretch |
