// Who failed (Second Shift 2026-11-14): this server's own checks, a bug in this server's code, or something outside it.
// GitHub-free, so the write core can use it.
// The messages JavaScript itself gives a TypeError/RangeError when this server's code is at fault.
const INTERNAL_BUG_RE = /Cannot (read|set) propert|is not a function|is not iterable|is not a constructor|is not defined|Cannot convert|of (undefined|null)\b|Maximum call stack|Invalid (array|string) length|Cannot access .* before initialization|Reduce of empty array/i;
/** True when an error is a fault in this server's own code (not the request, not GitHub). */
export const isInternalBug = (error) => error?.status === undefined && (error instanceof TypeError || error instanceof RangeError)
  && INTERNAL_BUG_RE.test(String(error?.message ?? ''));
/** True when this server's own checks refused the request (a TypeError/RangeError it threw on purpose). */
export const isOwnRefusal = (error) => error?.status === undefined && (error instanceof TypeError || error instanceof RangeError)
  && !isInternalBug(error) && !/fetch failed|ECONN|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket|network|timed? ?out|aborted/i.test(`${error?.message ?? ''} ${error?.cause?.code ?? ''} ${error?.cause?.message ?? ''}`);
