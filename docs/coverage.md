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
| `sso` (OIDC + SAML CRUD + set-status)         | yes     | ✓ | ✓ (server-side internal error pinned on list)  | |
| `domain approved` (CRUD + validate)           | yes     | ✓ | ✓                                              | |
| `domain public` (CRUD + check)                | yes     | ✓ | ✓                                              | |
| `domain emailing` (CRUD + verify)             | yes     | ✓ | ✓                                              | |
| `domain custom` (check)                       | yes     | ✓ | ✓                                              | |
| `app-registration` (CRUD + rotate + transfer + variables) | yes | ✓ | ✓                          | |
| `application` (install/uninstall/upgrade/sync + tokens) | yes | ✓ | ✓                          | |
| `marketplace` (install + sync-catalog)        | yes     | ✓ |                                               | |
| `front-component` (CRUD)                      | yes     | ✓ | ✓ (singular get AUTH-gated for API key)         | |
| `command-menu-item` (CRUD)                    | yes     | ✓ | ✓                                              | |
| `page-layout sync`                            | yes     | ✓ |                                                | |
| `chat send` + `delete-queued-message`         | yes     | ✓ | ✓ (AUTH-gated, same as rest of chat)            | |
| **Framework: schema drift**   | n/a     | ✓    | ✓           | n/a       |
| **Framework: resolveRemote**  | n/a     | ✓    | n/a         | n/a       |
| **Framework: seed automation**| n/a     | n/a  | ✓ (verified) | n/a      |

## Not yet mapped (post-v1.0)

| Domain                              | API status | Notes |
|-------------------------------------|------------|-------|
| Workflow steps + activation         | Blocked on Twenty image     | `createWorkflowVersionStep`, `activateWorkflowVersion` etc. NOT exposed on the pinned image — schema-drift test will flag when they appear |
| `uploadAiChatFile`                  | Multipart/form-data         | Requires extending GraphQLClient to support multipart; `chat send --file-ids` accepts pre-uploaded fileIds |
| Message folders + threads + participants | Read-only, derived | Available via `record list <object>` against the REST endpoint |
| Declarative `set-*` for blocklists / connected-accounts / channels | Reconcile UX | `reconcile<C>` is generic; v1.1+ candidate |
| `updatePageLayoutTabsAndWidgets` nested-input schema | Pass-through | Detailed nested validation deferred to twenty-sdk |
