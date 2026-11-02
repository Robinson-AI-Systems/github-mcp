// NATIVE-ERGO-1: plain, definite outcomes for typed native Git operations.
//
// The worker reports each mutation with a status. Some are final facts, not unknowns:
//   applied   - the operation ran and the workspace was read back;
//   conflict  - a merge/rebase/cherry-pick/revert/stash pop stopped with the listed conflicted files;
//   rejected  - Git refused it (non-zero exit, for example an invalid reference);
//   refused   - a worker check refused it before anything changed (newer workers);
//   uncertain / unconfirmed - genuinely unknown; inspect before retrying.
// Only the last pair is reported as unconfirmed. Everything here is redacted worker output (untrusted text).

export const DEFINITE_FAILURES = new Set(['rejected', 'refused']);
const clip = (text, n = 300) => String(text ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ').trim().slice(0, n);
const quote = text => JSON.stringify(clip(text, 120));

/** One plain next step for a final, non-success outcome. */
export function nextStep(operation, result = {}, options = {}) {
  const said = `${result.stderr ?? ''}\n${result.stdout ?? ''}\n${result.error ?? ''}`;
  const name = options.branch ?? options.name ?? options.ref;
  if (result.status === 'conflict') {
    const files = (result.conflicts ?? []).slice(0, 10).join(', ');
    const abort = { merge: 'merge_abort', rebase: 'rebase_abort', cherry_pick: 'cherry_pick_abort', revert: 'revert_abort', pull: 'merge_abort' }[operation];
    return `${operation} stopped with conflicts in ${files || 'the listed files'}. Fix each file (write_file), add them, then ${operation === 'rebase' ? 'rebase_continue' : operation === 'cherry_pick' ? 'cherry_pick_continue' : operation === 'revert' ? 'revert_continue' : 'commit'}${abort ? `; or run ${abort} to undo it` : ''}.`;
  }
  if (/Stale expectedGeneration|generation changed/i.test(said)) return 'Read the next generation below and send it as expectedGeneration with a new requestKey.';
  if (/invalid reference|did not match any|not a valid (?:object|ref)|unknown revision|couldn't find remote ref|not something we can merge|bad revision|ambiguous argument/i.test(said)) {
    if (operation === 'switch') return `The branch ${quote(name)} does not exist in this workspace. If it was made on GitHub, run fetch with options.branch ${quote(name)} and then switch again; to make a new one, use switch with options.create: true (and options.from for its start).`;
    if (operation === 'pull' || operation === 'fetch') return `GitHub has no branch ${quote(name)}. Check the name with github_git_workspace_read remote_refs.`;
    return `The reference ${quote(name)} does not exist in this workspace. Fetch it first (fetch with options.branch), or use an exact branch, tag or commit.`;
  }
  if (/already exists/i.test(said)) return `A branch or tag named ${quote(name)} already exists. Switch to it, or choose another name.`;
  if (/would be overwritten|Your local changes|untracked working tree files/i.test(said)) return 'Uncommitted changes in the workspace would be overwritten. Commit them, stash them (stash_push) or restore them, then try again.';
  if (/nothing to commit|nothing added to commit|no changes added/i.test(said)) return 'There was nothing staged to commit. Add the changed files first (add with options.all: true).';
  if (/Not possible to fast-forward|not a fast-forward|diverg|non-fast-forward|fetch first|Updates were rejected/i.test(said)) return operation === 'push'
    ? 'GitHub has commits this workspace does not. Fetch, merge (or rebase onto) origin/<branch>, then push again.'
    : 'The branches have diverged, so a fast-forward is not possible. Use merge (or rebase) with the fetched origin/<branch> instead.';
  if (/not fully merged/i.test(said)) return 'The branch has unmerged commits. Merge it first, or delete it anyway with options.force: true.';
  if (/does not exist|is not a file/i.test(said)) return 'Check the path with github_git_workspace_read status or changed_files.';
  if (/no (?:merge|rebase|cherry-pick|revert) (?:in progress|to abort)|There is no merge to abort|no rebase in progress/i.test(said)) return 'Nothing of that kind is in progress, so there was nothing to continue or abort.';
  if (/Expected remote head changed/i.test(said)) return 'The GitHub branch moved since you read it; nothing was pushed. Fetch, review, and push again with the new expectedHead.';
  if (/Non-fast-forward push refused/i.test(said)) return 'Fetch and merge the GitHub branch first, or push with options.force: true and the exact expectedHead lease.';
  return 'Read status (github_git_workspace_read) to see the current state, then adjust and run it with a new requestKey.';
}

/** A definite refusal as an error the write layer reports as rejected (never unconfirmed). */
export function definiteFailure(operation, result = {}, options = {}) {
  const why = clip(result.error || result.stderr || result.stdout || (result.status === 'rejected' ? `Git exited with code ${result.code}` : 'refused'));
  const next = nextStep(operation, result, options);
  const generation = Number.isSafeInteger(result.next_generation) ? result.next_generation : Number.isSafeInteger(result.generation) ? result.generation : null;
  const message = `${operation} did not happen${result.status === 'refused' || result.no_change ? ' (nothing was changed)' : ''}: ${why} Next: ${next}${generation !== null ? ` Next expectedGeneration: ${generation}.` : ''}`;
  return Object.assign(new TypeError(message.slice(0, 900)), { safeMessage: true, status: 422, safeCode: 'native_operation_refused',
    outcomeDetails: { outcome: result.status, operation, ...(generation !== null ? { next_generation: generation } : {}), next } });
}

const ESCAPES = { n: 10, t: 9, r: 13, '"': 34, '\\': 92, a: 7, b: 8, f: 12, v: 11 };
/** Paths that `git status --porcelain=v1` lists (C-style quoted names unquoted; renames give both sides). */
export function porcelainPaths(status) {
  const unquote = raw => {
    if (!raw.startsWith('"')) return raw;
    const bytes = []; const body = raw.slice(1, -1);
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (ch !== '\\') { bytes.push(...Buffer.from(ch)); continue; }
      const next = body[++i];
      if (/[0-7]/.test(next)) { bytes.push(parseInt(body.slice(i, i + 3), 8)); i += 2; }
      else bytes.push(ESCAPES[next] ?? next.charCodeAt(0));
    }
    return Buffer.from(bytes).toString('utf8');
  };
  const out = [];
  for (const line of String(status ?? '').split('\n')) {
    if (line.length < 4) continue;
    const rest = line.slice(3);
    const arrow = rest.match(/^("(?:[^"\\]|\\.)*"|[^"].*?) -> (.*)$/);
    if (arrow && /[RC]/.test(line.slice(0, 2))) { out.push(unquote(arrow[1]), unquote(arrow[2])); continue; }
    out.push(unquote(rest));
  }
  return [...new Set(out)];
}
