/**
 * `hsl(var(--token) / <alpha>)` helper.
 *
 * Tailwind's `<alpha-value>` placeholder is what lets `bg-primary/50` work with
 * CSS-variable colours; without it opacity modifiers silently do nothing.
 */
function withOpacity(variableName) {
  return `hsl(var(${variableName}) / <alpha-value>)`;
}

module.exports = { withOpacity };
