import type { BankIssue } from '../types';

/** Lists problems found in the question files, with file name and location. */
export function BankIssues({ issues, open = false }: { issues: BankIssue[]; open?: boolean }) {
  if (issues.length === 0) return null;
  const errors = issues.filter((i) => i.severity === 'error').length;
  const summary =
    errors > 0
      ? `${errors} problem${errors === 1 ? '' : 's'} found in the question files`
      : `${issues.length} note${issues.length === 1 ? '' : 's'} about the question files`;
  return (
    <details className="issues" open={open}>
      <summary>{summary}</summary>
      <ul>
        {issues.map((i, n) => (
          <li key={n}>
            <strong>{i.file}</strong> <span className="where">({i.location})</span>: {i.message}
          </li>
        ))}
      </ul>
    </details>
  );
}
