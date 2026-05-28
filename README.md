# twenty-ops

A token-efficient command-line interface for managing a **live [Twenty](https://twenty.com) CRM workspace** — built for command-line AI agents (Claude Code and the like) doing forward deployment of client CRMs.

> **Status:** v0.8. 23 command groups covering schema-as-code (objects,
> fields), records, views + navigation + groups, workflows + automated
> triggers, team setup (roles, members, invitations, permissions), API
> keys, webhooks, workspace settings (read+write), server-side
> programmability (logic functions), record-detail and dashboard page
> layouts (page-layout / tab / widget + view + fields widget upserts),
> workspace dashboards, and AI features (agents, skills, chat threads).
> See [`docs/coverage.md`](docs/coverage.md) for what's mapped vs deferred.

## Why a CLI?

Twenty ships an MCP server, but it is token-heavy. Because Twenty can do so many
things, the MCP cannot expose one small tool per operation — it wraps everything
behind a "get catalog tools" + "execute tool" abstraction and ships large JSON
tool schemas into the agent's context on every call.

A CLI is dramatically cheaper for an agent:

- **Discovery is paid once.** `twenty-ops --help` (and `twenty-ops <noun> --help`)
  is compact text the agent reads once and the model caches — not a schema
  re-sent per call.
- **Output is compact by default.** Lists render as aligned tables; a single
  record renders as `key=value` lines. `--json` switches to machine output
  (JSON, or JSON Lines for lists); `--fields a,b` projects to exactly the keys
  the agent asked for.
- **Outcomes are deterministic.** Exit codes (`0` ok, `2` usage, `3` auth,
  `4` not-found, `5` API) let the agent branch without parsing prose. Success
  is one terse line, or silent under `--quiet`.

## Install

Requires Node.js ≥ 20.

```bash
npm install
npm run build
node dist/cli.js --help          # or: npm link, then `twenty-ops --help`
```

## Authentication

`twenty-ops` reuses `~/.twenty/config.json` — the **same file the official
`twenty-sdk` CLI uses** — so connections are shared between the two tools.

```bash
twenty-ops remote add local --url http://localhost:3000 --key <API_KEY>
twenty-ops remote list
twenty-ops whoami                # verify the connection
```

Generate an API key in the Twenty UI under **Settings → APIs**. A remote can
also be supplied per-invocation with `--remote <name>`, or bypassed entirely
with the `TWENTY_API_URL` + `TWENTY_API_KEY` environment variables.

## Commands

```
remote    list | current | add <name> --url --key | use <name> | remove <name>
whoami    show the connected workspace
doctor    end-to-end self-check (remote + auth + schema + view + records round-trip)
settings  get                                    dump currentWorkspace config
          update [--file f.json] [--display-name | --allow-impersonation | ...]
                                                  workspace toggles + retention windows

api-key   list [--include-revoked]
          get <id>
          create --name [--expires-at <iso>] [--role <id|label>]
                                                  prints {token, apiKey} — store the
                                                  token now, it cannot be re-fetched
          revoke <id> | rotate <id> [--expires-at]

webhook   list | get <id>
          create --target-url <url> --operations <list> [--description] [--secret]
          update <id> [...] | delete <id>

view      list [--object <ref>] [--type <T>]   list views
          get <viewId>                          view + its fields/filters/sorts
          create --object <ref> --name [...]    create a view
          update <viewId> [...] | delete <viewId>
          set-fields        <viewId> --file f.json    reconcile fields
          set-filters       <viewId> --file f.json    reconcile filters
          set-sorts         <viewId> --file f.json    reconcile sorts
          set-groups        <viewId> --file f.json    kanban fieldValue buckets
          set-filter-groups <viewId> --file f.json    AND/OR hierarchies for filters
          set-field-groups  <viewId> --file f.json    collapsible section labels

nav       list | add --name (--view <id> | --folder | --link <url>) [...]
          update <navItemId> [...] | remove <navItemId>

workflow  list | get <id> | versions <id> | runs <id> [...]
          create --name                         create a workflow
          update <id> --name | delete <id>
          version get <versionId>                trigger + steps of a version
          set-trigger <versionId> --file f.json  set a DRAFT version's trigger
          run get <runId>                        a run including per-step state
          trigger list <workflowId>              CRON / DATABASE_EVENT triggers
          trigger get <triggerId>
          trigger create --workflow <id> --file f.json
          trigger update <triggerId> --file f.json | trigger delete <triggerId>

record    list <object> [--filter --limit --order-by --starting-after]
          get <object> <id> | create <object> --file f.json
          update <object> <id> --file f.json | delete <object> <id>
          restore <object> <id>                  un-soft-delete from recycle bin
          bulk-upsert <object> --file f.json --key <fieldName>
                                                 declarative reconcile by key
          merge <object> <id1> <id2> [--priority N] [--dry-run]
                                                 dedup people/companies

object    list [--include-inactive] | get <ref>
          create --file f.json | update <ref> --file f.json | delete <ref>

field     list --object <ref> [--include-inactive] | get <id>
          create --object <ref> --file f.json | update <id> --file f.json | delete <id>

role        list | get <ref> | create --file f.json | update <ref> --file f.json
            delete <ref> --force

member      list [--limit N] | get <ref>             ref = id or email
            set-role --member <ref> --role <ref>
            set-settings <ref> --file f.json
            remove <ref> --force

invitation  list | send --emails a,b [--role <ref>] | resend <id> | revoke <id>

permission  show --role <ref>
            set-object --role <ref> --object <ref>
                       [--read --write --soft-delete --destroy]
            set-field  --role <ref> --object <ref> --field <id>
                       [--read --write]
            set-flag   --role <ref> --flag <NAME> (--enable | --disable)
            apply --role <ref> --file f.json     declarative bulk

logic-function
            list | get <ref> | source <ref>     ref = id or unique name
            create --file f.json                pass-through to Twenty's mutation
            update <ref> --file f.json | delete <ref>
            execute <ref> [--input <json> | --input-file f.json]
                                                  run the handler, print result

page-layout list --object <ref> [--type T]   T = RECORD_INDEX | RECORD_PAGE |
                                                  DASHBOARD | STANDALONE_PAGE
            get <id> | create --file f.json | update <id> --file f.json
            delete <id>                          # destroyPageLayout (hard)
            reset <id>                            # stock layouts only
            tab list <pageLayoutId>
            tab get <tabId> | tab create --page-layout <id> --file f.json
            tab update <tabId> --file f.json | tab delete <tabId> | tab reset <tabId>
            widget list <pageLayoutTabId>
            widget get <widgetId> | widget create --tab <id> --file f.json
            widget update <id> --file | widget delete <id> | widget reset <id>
            widget configure-view   <widgetId> --file f.json   upsertViewWidget
            widget configure-fields <widgetId> --file f.json   upsertFieldsWidget

dashboard   list [--limit N] [--starting-after <cursor>]
            get <id> | create --file f.json | update <id> --file f.json
            delete <id>                           # soft-delete
            restore <id>

skill       list | get <ref>                      ref = id or unique name
            create --file f.json | update <ref> --file f.json | delete <ref>
            activate <ref> | deactivate <ref>

agent       list | get <ref> | create --file f.json
            update <ref> --file f.json | delete <ref>
            set-role --agent <ref> --role <ref>
            clear-role --agent <ref>
            turns <agentId>                       # list past reasoning turns
            evaluate <turnId>                     # re-run evaluation (LLM cost)
            stop-stream <threadId>

chat        list | get <threadId>
            create | rename <threadId> --title <text>
            archive <threadId> | unarchive <threadId> | delete <threadId>
            messages <threadId>                   # user-context only on this build
```

`--object` accepts an `objectMetadataId` **or** an object name
(`person`, `companies`, …). The `set-*` and `record bulk-upsert` commands
are **declarative and idempotent** — they diff the desired state against
the workspace and issue only the needed create/update/delete calls,
reporting `+created ~updated -deleted =unchanged`.

`record` uses Twenty's REST API (`/rest/{namePlural}`) so it works
identically against any object — standard or custom — in any workspace,
without per-workspace code generation. The one exception is `restore`,
which calls the GraphQL `restore<Object>` mutation (REST has no
equivalent).

### Schema-as-code

`object` and `field` let an agent stand up a custom CRM end-to-end —
no UI clicks required. JSON/YAML files are the source of truth; the
file's contents pass through to Twenty verbatim so per-type quirks
(field `type` enum, `defaultValue`/`options` shapes) live with the
input.

```bash
# Define a custom object
cat > project.json <<'EOF'
{ "nameSingular": "project", "namePlural": "projects",
  "labelSingular": "Project", "labelPlural": "Projects",
  "icon": "IconBriefcase" }
EOF
twenty-ops object create --file project.json --json

# Populate it with fields
cat > status.json <<'EOF'
{ "name": "status", "label": "Status", "type": "SELECT",
  "options": [
    { "value": "ACTIVE", "label": "Active", "color": "green", "position": 0 },
    { "value": "DONE",   "label": "Done",   "color": "gray",  "position": 1 }
  ] }
EOF
twenty-ops field create --object project --file status.json
```

### Team setup

Stand up RBAC, invite teammates, and tune workspace toggles end-to-end:

```bash
# Define a custom role
cat > role.json <<'EOF'
{ "label": "Sales Ops", "description": "Pipeline + reporting",
  "canBeAssignedToUsers": true, "canBeAssignedToApiKeys": false }
EOF
twenty-ops role create --file role.json --json

# Apply permissions declaratively (replaces — see permission apply notes)
cat > perms.json <<'EOF'
{
  "objects": [
    { "object": "person",  "read": true, "write": true },
    { "object": "company", "read": true, "write": true }
  ],
  "flags": ["WORKFLOWS", "VIEWS", "EXPORT_CSV"]
}
EOF
twenty-ops permission apply --role "Sales Ops" --file perms.json

# Invite a teammate to that role
twenty-ops invitation send --emails sales-lead@usva.fi --role "Sales Ops"

# Adjust workspace-wide toggles
twenty-ops settings update --is-public-invite-link-enabled false \
                           --trash-retention-days 90
```

> **Note**: `invitation send` and `settings update` require a *user* context.
> API keys can `invitation list` and `settings get`, but the mutations return
> `EXIT.AUTH` with "user context required" — that's a Twenty server-side
> constraint, not a CLI limitation.

### Programmability

Inspect, execute, and manage server-side logic functions, plus wire up
workflow automated triggers (CRON / DATABASE_EVENT):

```bash
# Inspect what's already deployed in the workspace
twenty-ops logic-function list --json
twenty-ops logic-function source my-handler           # print the TS source

# Invoke a deployed handler with a payload
twenty-ops logic-function execute my-handler \
                                   --input '{"name":"Ada"}' --json

# Wire a CRON automated trigger to a workflow
cat > trigger.json <<'EOF'
{ "type": "CRON",
  "settings": { "schedule": "0 9 * * 1-5" } }
EOF
twenty-ops workflow trigger create --workflow <workflowId> --file trigger.json
```

> **Authoring path**: scaffold + deploy logic functions with
> `yarn twenty add logicFunction` and `yarn twenty install` (the official
> SDK packs them into a tarball the server expects). This CLI's
> `logic-function create/update` are pass-through escape hatches — useful
> when an agent already has the right wire shape.
>
> **Activation**: `workflow trigger create` registers the trigger record
> but does NOT activate the workflow version. `activateWorkflowVersion`
> is still unexposed on the pinned Twenty image; activate through the
> Twenty UI until a later image lifts the gate.

### Record-detail pages + dashboards as code

Define custom record-detail pages and workspace dashboards from JSON:

```bash
# 1) Create a record-detail page layout scoped to an object
cat > layout.json <<'EOF'
{ "name": "Sales person view", "type": "RECORD_PAGE",
  "objectMetadataId": "<personObjectId>" }
EOF
twenty-ops page-layout create --file layout.json --json
# → { "id": "<layoutId>", ... }

# 2) Add a tab to the layout
cat > tab.json <<'EOF'
{ "title": "Pipeline", "position": 0, "layoutMode": "GRID" }
EOF
twenty-ops page-layout tab create --page-layout <layoutId> --file tab.json --json

# 3) Drop a VIEW widget on the tab, then bind it to an existing view
cat > widget.json <<'EOF'
{ "title": "Open deals", "type": "VIEW",
  "gridPosition": { "row": 0, "column": 0, "rowSpan": 4, "columnSpan": 12 },
  "configuration": { "__typename": "ViewConfiguration", "viewId": "<viewId>" } }
EOF
twenty-ops page-layout widget create --tab <tabId> --file widget.json --json

# 4) Wire the widget's view content explicitly
cat > view-cfg.json <<'EOF'
{ "viewFields": [{ "fieldMetadataId": "<nameFieldId>", "isVisible": true, "position": 0 }],
  "viewFilters": [], "viewFilterGroups": [], "viewSorts": [] }
EOF
twenty-ops page-layout widget configure-view <widgetId> --file view-cfg.json

# 5) Define a dashboard that uses a DASHBOARD-typed page layout
twenty-ops page-layout create --file dashboard-layout.json --json
twenty-ops dashboard create --file dashboard.json --json
```

> **Configuration shape**: each `WidgetType` has its own typed configuration
> (e.g. `ViewConfiguration { viewId }`, `IframeConfiguration { url }`,
> `StandaloneRichTextConfiguration { content }`). Twenty validates the shape
> server-side and rejects mismatches with `"Invalid configuration: missing
> configuration type"` — capture the exact shape from a working widget via
> `page-layout widget get <id> --json` once you have one.
>
> **Reset only on stock layouts**: `page-layout reset` /
> `page-layout tab reset` / `page-layout widget reset` only work on stock
> Twenty layouts. Custom layouts return `"Custom page layout … cannot be
> reset to default"` — delete + recreate instead.

### AI agents + skills + chat

Define agents, attach skills, inspect their reasoning history:

```bash
# 1) Author a skill (active by default after create)
cat > skill.json <<'EOF'
{ "name": "summarizeLeads",
  "label": "Summarize Leads",
  "description": "Condense a list of leads into a one-paragraph brief.",
  "content": "You are a sales analyst. Given a JSON array of leads,
              return a 3-sentence summary highlighting the top opportunity." }
EOF
twenty-ops skill create --file skill.json --json
twenty-ops skill list

# Deactivate / reactivate without deleting
twenty-ops skill deactivate summarizeLeads
twenty-ops skill activate summarizeLeads

# 2) Create a workspace agent (requires a configured model in the stack)
cat > agent.json <<'EOF'
{ "name": "salesAssistant",
  "label": "Sales Assistant",
  "description": "Helps reps triage incoming leads.",
  "prompt": "You are a sales assistant. Be concise.",
  "modelId": "gpt-4o-mini" }
EOF
twenty-ops agent create --file agent.json --json
twenty-ops agent set-role --agent salesAssistant --role "Sales Ops"

# 3) Inspect past reasoning turns
twenty-ops agent turns <agentId> --json
twenty-ops agent evaluate <turnId>     # re-runs LLM evaluation (cost-bearing)
```

> **AI feature gates**: `agent create` requires a model configured in the
> workspace (the seeded test stack rejects with `"The selected model is
> not available in this workspace."` — production stacks tie this to the
> Twenty Cloud billing tier).
>
> **Chat threads are user-context only**: every `chat` command (read AND
> write) returns `EXIT.AUTH` with `"This endpoint requires a user
> context. API keys are not supported."` against the current build. The
> CLI's wire shapes are correct; agents that need to drive chat threads
> programmatically need a user-token remote, not an API-key remote.
>
> **Deferred to v0.9**: `chat send` (sendChatMessage — streaming
> responses) and `uploadAiChatFile` (multipart upload) need separate
> design and are not in v0.8.

### Example: an agent setting up a view

```bash
twenty-ops view create --object person --name "Hot Leads" --icon IconFlame --json
# {"id":"…","name":"Hot Leads",…}
twenty-ops view set-filters <viewId> --file leads-filter.json
twenty-ops nav add --view <viewId> --name "Hot Leads" --icon IconFlame
```

## Known limitations (Twenty API as of v2.x)

This prototype was verified against `twentycrm/twenty:latest`. That build's
GraphQL API constrains workflow management:

- `createWorkflowVersion` is forbidden — Twenty auto-creates the DRAFT version
  when a workflow is created.
- A workflow version is editable only while in `DRAFT`.
- `updateWorkflowVersion` accepts `name` and `trigger`, but **rejects `steps`**
  ("use `createWorkflowVersionStep`…") and **rejects `status`**
  ("Cannot update workflow version status manually").
- No `createWorkflowVersionStep`, `activateWorkflowVersion` or
  `runWorkflowVersion` resolvers are exposed on the introspectable API.

So v1 covers workflow **record CRUD**, **draft trigger editing**, and full
**inspection** of versions and runs. Authoring workflow *steps* and
*activating/running* workflows need Twenty resolvers this build does not expose
— that is a later phase (and useful feedback for the Twenty team).

## Development & testing

```bash
npm run check                    # typecheck + unit tests (the local gate)
npm run typecheck
npm test                         # unit tests (hermetic, < 1s)
TWENTY_E2E=1 npm run test:e2e    # legacy e2e (local stack, refuses non-local hosts)
```

Integration tests run against a real Twenty stack. Bring up the pinned
local stack (separate from your main dev workspace — own port, own
volume):

```bash
cd deploy && cp .env.test.example .env.test && cd ..
npm run test:up                  # starts pinned Twenty on http://localhost:3001
# (one-time: sign up in the UI, generate an API key,
#  then: twenty-ops remote add twenty-ops-test --url http://localhost:3001 --key …)
TWENTY_OPS_TEST_REMOTE=twenty-ops-test npm run test:integration
npm run test:down
```

**Self-check.** Once a remote is configured, `twenty-ops doctor` runs a
quick end-to-end probe — remote resolves, `whoami` returns a workspace,
the live schema matches the committed snapshot, a throwaway view
round-trips cleanly. `--json` emits a structured summary suitable for an
agent to branch on. Exits non-zero on the first failing step.

**Schema-drift detection.** `test/fixtures/schema.snapshot.json` records
every Core + Metadata GraphQL resolver and its argument names against
the pinned Twenty image. `npm run test:drift` fails if the live stack
exposes anything different. When Twenty is intentionally upgraded
(digest in `deploy/docker-compose.yml`):

```bash
TWENTY_OPS_TEST_REMOTE=twenty-ops-test npm run snapshot:schema
# review the diff in test/fixtures/schema.snapshot.json, then commit
```

**Per-feature merge bar (strict).** A new command merges only when all
of these are green: unit tests for the command (arg parsing, query
shape, output, error paths), an integration test (success + ≥1 error
path against the pinned stack), a lifecycle e2e entry chaining it with
other commands, schema snapshot updated if new resolvers are touched,
and the row in [`docs/coverage.md`](docs/coverage.md) updated. See the
plan in `.claude/plans/i-want-to-create-crispy-sparrow.md` for the
full buildout sequence.

Architecture: `commander` for the command tree; a thin hand-written
`fetch`-based GraphQL client (no per-workspace code generation, so the tool
stays portable across any Twenty workspace). Views/navigation use Twenty's
Metadata API (`/metadata`); workflows use the Core API (`/graphql`).

## License

AGPL-3.0-only — matching Twenty, so this can be proposed upstream.
