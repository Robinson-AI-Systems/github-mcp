// A full ordinary connection represents the user's existing consent, not a
// restricted service pass. Never infer authority from an account name/domain.
// Authentication, credential scope, tenant binding and revocation are checked
// independently by the connection/provider layers.
export const isOwnerConnection = connection => connection?.profile === 'full' && !connection?.pass && connection?.kind !== 'pass';
// PUB-8: the service operator is the owner's own direct connection (a full connector on the operator's database, marked
// `operator: true` only by that route). A person's tenant connection, a service pass or an RTC door never carries the mark.
export const isOperatorConnection = connection => connection?.operator === true && isOwnerConnection(connection);
/** Wraps the operator route's `toConnection` so its full connector connections carry the operator mark. */
export const operatorConnection = (toConnection) => (record, env) => {
  const decision = toConnection(record, env);
  if (!decision?.connection || record?.kind !== 'connector') return decision;
  return { ...decision, connection: Object.freeze({ ...decision.connection, operator: true }) };
};
