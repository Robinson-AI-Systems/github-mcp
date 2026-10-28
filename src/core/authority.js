// A full ordinary connection represents the user's existing consent, not a
// restricted service pass. Never infer authority from an account name/domain.
// Authentication, credential scope, tenant binding and revocation are checked
// independently by the connection/provider layers.
export const isOwnerConnection = connection => connection?.profile === 'full' && !connection?.pass && connection?.kind !== 'pass';
