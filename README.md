# twenty-ops

A token-efficient command-line interface for managing a **live [Twenty](https://twenty.com) CRM workspace** — built for command-line AI agents (Claude Code and the like) doing forward deployment of client CRMs.

> **Status:** v0.1 prototype. Scope is deliberately small: **views & navigation** and **workflows**. Records and metadata/schema editing are future phases.

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

view      list [--object <ref>] [--type <T>]   list views
          get <viewId>                          view + its fields/filters/sorts
          create --object <ref> --name [...]    create a view
          update <viewId> [...] | delete <viewId>
          set-fields  <viewId> --file f.json    reconcile fields  (declarative)
          set-filters <viewId> --file f.json    reconcile filters (declarative)
          set-sorts   <viewId> --file f.json    reconcile sorts   (declarative)

nav       list | add --name (--view <id> | --folder | --link <url>) [...]
          update <navItemId> [...] | remove <navItemId>

workflow  list | get <id> | versions <id> | runs <id> [...]
          create --name                         create a workflow
          update <id> --name | delete <id>
          version get <versionId>                trigger + steps of a version
          set-trigger <versionId> --file f.json  set a DRAFT version's trigger
          run get <runId>                        a run including per-step state
```

`--object` accepts an `objectMetadataId` **or** an object name
(`person`, `companies`, …). The `set-*` commands are **declarative and
idempotent** — they diff the file against the workspace and issue only the
needed create/update/delete calls, reporting `+created ~updated -deleted =unchanged`.

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

## Development

```bash
npm run typecheck
npm test                         # unit tests (hermetic)
TWENTY_E2E=1 npm run test:e2e     # e2e — local stack only; refuses non-local hosts
```

Architecture: `commander` for the command tree; a thin hand-written
`fetch`-based GraphQL client (no per-workspace code generation, so the tool
stays portable across any Twenty workspace). Views/navigation use Twenty's
Metadata API (`/metadata`); workflows use the Core API (`/graphql`).

## License

AGPL-3.0-only — matching Twenty, so this can be proposed upstream.
