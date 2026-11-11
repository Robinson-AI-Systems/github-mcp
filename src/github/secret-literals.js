export const HIDDEN='[hidden]';
// HIDDEN-GUARD-1: a value that is exactly one template placeholder is source code, never a literal secret.
const TEMPLATE=/^(?:\{[A-Za-z_][\w.]*(?:![rsa])?(?::[^{}]*)?\}|\$\{[A-Za-z_][\w.]*\}|\{\{\s*[A-Za-z_][\w.]*\s*\}\})$/;
export function assignedLiteral(text, start, {allowExpressions=false}={}) {
 const quote = text[start];
 if (quote === '"' || quote === "'") {
  let end = start + 1;
  while (end < text.length && text[end] !== '\n' && text[end] !== '\r') {
   if (text[end] === quote) { if (text[end+1] === quote) { end += 2; continue; } break; }
   if (text[end] === '\\' && end+1 < text.length) { end += 2; continue; }
   end++;
  }
  const quoted=text.slice(start+1,end);
  return { index: start+1, length: quoted===HIDDEN||(!allowExpressions&&TEMPLATE.test(quoted))?0:end-start-1 };
 }
 let end = start;
 while (end < text.length && !/[;\r\n"'`<>]/.test(text[end])) end++;
 let value = text.slice(start,end).replace(/[ \t]+#.*$/,'').trimEnd();
 // Configuration interpolation and executable expressions are not literal passwords.
 if (value===HIDDEN) value='';
 // HIDDEN-GUARD-1: a Python/str.format placeholder ({password}) is code, not a literal password.
 if (!allowExpressions&&TEMPLATE.test(value)) value = '';
 if (!allowExpressions&&/^(?:\$|\{\{|process\.|env\.|[A-Za-z_$][\w.$]*\s*[([])/.test(value)) value = '';
 return { index: start, length: value.length };
}
