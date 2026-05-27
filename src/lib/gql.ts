/** Reusable GraphQL selection sets — kept terse to minimise response size. */

export const VIEW_SUMMARY = `id name objectMetadataId type key icon position visibility isCustom`;

export const VIEW_FIELD = `id fieldMetadataId isVisible size position`;
export const VIEW_FILTER = `id fieldMetadataId operand value subFieldName`;
export const VIEW_SORT = `id fieldMetadataId direction`;

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

/** Workspace member — `name` is a nested FullName object. */
export const MEMBER_SUMMARY = `
  id userEmail
  name { firstName lastName }
  locale colorScheme timeZone dateFormat timeFormat calendarStartDay numberFormat
  roles { id label }
`;

/** Workspace invitation — `id` doubles as the appTokenId for resend/revoke. */
export const INVITATION_SUMMARY = `id email roleId expiresAt`;

/** A v4 UUID — used to pre-fill `id` fields the API leaves optional. */
export function uuid(): string {
  return crypto.randomUUID();
}

/** True when a string is a UUID (so `--object` can accept an id or a name). */
export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
