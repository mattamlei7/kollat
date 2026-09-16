/** Empty, error and loading are compositions, not fallbacks. */

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="px-[var(--gutter)] py-12 max-w-[52ch]">
      <h2 className="display-sm text-balance">{title}</h2>
      <p className="mt-3 body text-t2">{body}</p>
      {action && (
        <button type="button" onClick={action.onClick} className="btn btn-primary mt-6">
          {action.label}
        </button>
      )}
    </div>
  );
}

/** Names the protocol and what failed. The rest of the page stays live. */
export function ErrorLine({ name, message, retryable }: { name: string; message: string; retryable?: boolean }) {
  return (
    <p className="text-t2">
      <span className="font-semibold text-t1">{name}</span> unavailable — {shorten(message)}
      {retryable ? ". Retrying on the next refresh." : "."}
    </p>
  );
}

export function StaleBadge() {
  return (
    <span className="badge" title="The last refresh failed; showing the previous reading.">
      stale
    </span>
  );
}

/** Rows at the real row height so the table does not reflow on arrival. */
export function SkeletonRows({ cols, rows = 4 }: { cols: number; rows?: number }) {
  return (
    <tbody aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }, (_, c) => (
            <td key={c}>
              {c === 0 ? (
                <span className="name-cell">
                  <span className="avatar" />
                  <span className="skel" style={{ width: 56 }} />
                </span>
              ) : (
                <span className="skel" style={{ width: 72 }} />
              )}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

function shorten(msg: string) {
  const first = msg.split("\n")[0];
  return first.length > 140 ? first.slice(0, 140) + "…" : first;
}
