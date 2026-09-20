import { PGlite } from "@electric-sql/pglite";

type Row = Record<string, unknown>;
type Executor = { query: (text: string, params?: unknown[]) => Promise<{ rows: Row[] }> };

/** Execute the actual production SQL against in-memory Postgres. Only the Neon
 * HTTP transport is replaced; lazy query/transaction semantics are preserved. */
export function postgresTransport(db: PGlite) {
  class Query implements PromiseLike<Row[]> {
    constructor(readonly text: string, readonly params: unknown[]) {}
    async run(executor: Executor) { return (await executor.query(this.text, this.params)).rows; }
    then<T = Row[], E = never>(resolve?: ((rows: Row[]) => T | PromiseLike<T>) | null, reject?: ((reason: unknown) => E | PromiseLike<E>) | null): Promise<T | E> {
      return this.run(db).then(resolve, reject);
    }
  }
  const sql = (parts: TemplateStringsArray, ...params: unknown[]) => new Query(
    parts.reduce((text, part, i) => text + (i ? `$${i}` : "") + part, ""),
    params.map((p) => p !== null && typeof p === "object" && !Array.isArray(p) && !(p instanceof Date) ? JSON.stringify(p) : p),
  );
  return Object.assign(sql, {
    transaction: (queries: Query[]) => db.transaction(async (tx) => {
      const results = [];
      for (const query of queries) results.push(await query.run(tx));
      return results;
    }),
  });
}
