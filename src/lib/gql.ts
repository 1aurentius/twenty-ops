/** Reusable GraphQL selection sets — kept terse to minimise response size. */

export const VIEW_SUMMARY = `id name objectMetadataId type key icon position visibility isCustom`;

export const VIEW_FIELD = `id fieldMetadataId isVisible size position`;
export const VIEW_FILTER = `id fieldMetadataId operand value subFieldName`;
export const VIEW_SORT = `id fieldMetadataId direction`;

/** View group — distinct value of a kanban/grouping field. Keyed by `fieldValue` per view. */
export const VIEW_GROUP = `id isVisible fieldValue position viewId`;
/** View filter group — hierarchical AND/OR container for filters. */
export const VIEW_FILTER_GROUP = `id parentViewFilterGroupId logicalOperator positionInViewFilterGroup viewId`;
/** View field group — collapsible section of fields. Keyed by `name` per view. */
export const VIEW_FIELD_GROUP = `id name position isVisible viewId`;

/** Full view detail — summary plus its widgets. */
export const VIEW_DETAIL = `
  ${VIEW_SUMMARY}
  viewFields { ${VIEW_FIELD} }
  viewFilters { ${VIEW_FILTER} }
  viewSorts { ${VIEW_SORT} }
`;

export const NAV_ITEM = `id type name icon viewId folderId link color position`;

/** Object metadata — the schema-as-code identity record for an object type. */
export const OBJECT_SUMMARY = `id nameSingular namePlural labelSingular labelPlural icon isCustom isActive`;

/** Field metadata — schema-as-code identity record for a field on an object. */
export const FIELD_SUMMARY = `id name label type isCustom isActive isNullable objectMetadataId description icon`;

/** API key — workspace bearer token holder. `role` is selected as a nested id+label. */
export const API_KEY_SUMMARY = `id name expiresAt revokedAt createdAt updatedAt role { id label }`;

/** Webhook — event subscription. `secret` is server-generated unless provided on create. */
export const WEBHOOK_SUMMARY = `id targetUrl operations description secret createdAt updatedAt`;

/** Role — RBAC identity record. */
export const ROLE_SUMMARY = `id label description icon canBeAssignedToUsers canBeAssignedToApiKeys isEditable`;

/** Logic function — server-side TypeScript source bound to a handler.  */
export const LOGIC_FUNCTION_SUMMARY = `
  id name description runtime timeoutSeconds
  sourceHandlerPath handlerName applicationId
  createdAt updatedAt
`;

/** Page layout — RECORD_INDEX / RECORD_PAGE / DASHBOARD / STANDALONE_PAGE. */
export const PAGE_LAYOUT_SUMMARY = `id name type objectMetadataId createdAt updatedAt`;

/** Tab inside a page layout. `layoutMode` = GRID | VERTICAL_LIST | CANVAS. */
export const PAGE_LAYOUT_TAB_SUMMARY = `
  id title position pageLayoutId icon layoutMode isActive createdAt updatedAt
`;

/**
 * Widget inside a tab. `type` is the WidgetType enum.
 *
 * `position` and `configuration` are GraphQL unions (each widget type has its
 * own concrete type — PageLayoutWidgetGridPosition / ViewConfiguration / etc.),
 * so they're omitted from this summary. CRUD writes the input shapes directly;
 * downstream readers fetch the typed records via the Twenty UI or a dedicated
 * widget-type-specific query.
 */
export const PAGE_LAYOUT_WIDGET_SUMMARY = `
  id title type pageLayoutTabId objectMetadataId
  conditionalDisplay conditionalAvailabilityExpression
  isActive createdAt updatedAt
`;

/** Dashboard — core record visible in Twenty's "Dashboards" section. */
export const DASHBOARD_SUMMARY = `
  id title position pageLayoutId createdAt updatedAt
`;

/** Skill — named tool/behavior an agent can perform. */
export const SKILL_SUMMARY = `
  id name label icon description isCustom isActive applicationId createdAt updatedAt
`;

/** Agent — workspace-scoped LLM-backed assistant. */
export const AGENT_SUMMARY = `
  id name label icon description prompt modelId roleId isCustom applicationId
  evaluationInputs createdAt updatedAt
`;

/**
 * Agent reasoning turn — captured execution of a single user→assistant cycle.
 * `evaluations` and `messages` are LIST(NON_NULL) unions; omitted from this
 * summary to keep the selection scalar. Read via the Twenty UI for details.
 */
export const AGENT_TURN_SUMMARY = `id threadId agentId createdAt`;

/**
 * Chat thread (`AgentChatThread`) — persistent multi-turn conversation with an
 * agent. Token + credit counters are included so an agent can budget cost
 * before continuing the thread.
 */
export const CHAT_THREAD_SUMMARY = `
  id title conversationSize
  totalInputTokens totalOutputTokens contextWindowTokens
  totalInputCredits totalOutputCredits
  lastMessageAt createdAt updatedAt
`;

/**
 * Connected account (core API) — workspace member's email/calendar OAuth
 * binding. Tokens are deliberately omitted from the summary (secrets); use
 * --fields to surface them when needed for debugging.
 */
export const CONNECTED_ACCOUNT_SUMMARY = `
  id handle provider accountOwnerId
  handleAliases authFailedAt lastCredentialsRefreshedAt
  createdAt updatedAt
`;

/**
 * Connected account (metadata API) — `myConnectedAccounts` returns a
 * different shape (`ConnectedAccountDTO`) without `accountOwnerId` but with
 * `userWorkspaceId`, `name`, `visibility`, and `lastSignedInAt`.
 */
export const CONNECTED_ACCOUNT_DTO_SUMMARY = `
  id handle provider name visibility
  userWorkspaceId connectionProviderId applicationId
  handleAliases authFailedAt lastCredentialsRefreshedAt lastSignedInAt
  createdAt updatedAt
`;

/**
 * Message channel — per-mailbox inbound sync settings + status.
 * `handle` is the email address; `type` distinguishes Gmail/Outlook/etc.
 */
export const MESSAGE_CHANNEL_SUMMARY = `
  id handle type visibility connectedAccountId
  isSyncEnabled syncStatus syncStage syncedAt
  isContactAutoCreationEnabled contactAutoCreationPolicy
  excludeNonProfessionalEmails excludeGroupEmails
  createdAt updatedAt
`;

/** Calendar channel — per-calendar inbound sync settings + status. */
export const CALENDAR_CHANNEL_SUMMARY = `
  id handle visibility connectedAccountId
  isSyncEnabled syncStatus syncStage syncedAt
  isContactAutoCreationEnabled contactAutoCreationPolicy
  createdAt updatedAt
`;

/** Blocklist entry — `handle` is the address to filter for `workspaceMemberId`. */
export const BLOCKLIST_SUMMARY = `
  id handle workspaceMemberId createdAt updatedAt
`;

/** SSO identity provider summary (OIDC or SAML). */
export const SSO_PROVIDER_SUMMARY = `id name type status issuer`;

/** Approved-access domain — invite-only signups allowed from a verified domain. */
export const APPROVED_ACCESS_DOMAIN_SUMMARY = `id domain isValidated createdAt`;

/** Public domain — workspace-facing custom domain (may be bound to an applicationId). */
export const PUBLIC_DOMAIN_SUMMARY = `id domain isValidated applicationId createdAt`;

/** Emailing domain — outbound email sender. `driver` is AWS_SES on this build. */
export const EMAILING_DOMAIN_SUMMARY = `
  id domain driver status verifiedAt createdAt updatedAt
  verificationRecords { type key value priority }
`;

/** Application registration — OAuth client + metadata that backs an installable app. */
export const APPLICATION_REGISTRATION_SUMMARY = `
  id name universalIdentifier oAuthClientId
  oAuthRedirectUris oAuthScopes
  ownerWorkspaceId sourceType sourcePackage latestAvailableVersion
  isListed isFeatured isPreInstalled isConfigured logoUrl
  createdAt updatedAt
`;

/** Application registration variable — typed config slot (string value, may be secret). */
export const APPLICATION_REGISTRATION_VARIABLE_SUMMARY = `
  id key description isSecret isRequired isFilled createdAt updatedAt
`;

/** Application — installed app instance within a workspace. */
export const APPLICATION_SUMMARY = `
  id name description version universalIdentifier
  packageJsonChecksum yarnLockChecksum
  applicationRegistrationId canBeUninstalled defaultRoleId
  settingsCustomTabFrontComponentId logo
`;

/** Workspace member — `name` is a nested FullName object. */
export const MEMBER_SUMMARY = `
  id userEmail
  name { firstName lastName }
  locale colorScheme timeZone dateFormat timeFormat calendarStartDay numberFormat
  roles { id label }
`;

/** Workspace invitation — `id` doubles as the appTokenId for resend/revoke. */
export const INVITATION_SUMMARY = `id email roleId expiresAt`;

/**
 * Role with full nested permissions — used by `permission show`. Includes the
 * role-wide "can*All*" booleans plus the per-object/per-field rows.
 *
 * Note ObjectPermission has NO id field; (roleId implicit, objectMetadataId)
 * is its composite key. FieldPermission and PermissionFlag both have ids.
 */
export const ROLE_PERMISSIONS = `
  id label
  canUpdateAllSettings canAccessAllTools
  canReadAllObjectRecords canUpdateAllObjectRecords
  canSoftDeleteAllObjectRecords canDestroyAllObjectRecords
  permissionFlags { id flag }
  objectPermissions {
    objectMetadataId
    canReadObjectRecords canUpdateObjectRecords
    canSoftDeleteObjectRecords canDestroyObjectRecords
  }
  fieldPermissions {
    id objectMetadataId fieldMetadataId
    canReadFieldValue canUpdateFieldValue
  }
`;

/** A v4 UUID — used to pre-fill `id` fields the API leaves optional. */
export function uuid(): string {
  return crypto.randomUUID();
}

/** True when a string is a UUID (so `--object` can accept an id or a name). */
export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
