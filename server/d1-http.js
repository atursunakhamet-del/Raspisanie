// D1's HTTP API documents string parameters. JSON preserves numbers and NULL
// while keeping every value separate from the SQL text.
function httpQuery({ sql, values }) {
  if (!values.length) return { sql };
  return {
    // The shared API uses positional placeholders in static SQL.
    sql: sql.replaceAll('?', () => "json_extract(?, '$')"),
    params: values.map(value => JSON.stringify(value)),
  };
}

export function d1Http({ D1_ACCOUNT_ID, D1_DATABASE_ID, D1_API_TOKEN }) {
  if (!D1_ACCOUNT_ID || !D1_DATABASE_ID || !D1_API_TOKEN) return undefined;
  const account = encodeURIComponent(D1_ACCOUNT_ID);
  const database = encodeURIComponent(D1_DATABASE_ID);
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`;

  async function query(payload, count) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${D1_API_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    if (!response.ok || !data.success || data.result?.length !== count ||
        !data.result.every(result => result.success)) {
      const errors = [...(data.errors ?? []), ...(data.result ?? [])];
      if (errors.some(error => /UNIQUE constraint failed/i.test(error.message ?? error.error ?? ''))) {
        throw new Error('UNIQUE constraint failed');
      }
      throw new Error(`D1 query failed (HTTP ${response.status})`);
    }
    return data.result;
  }

  const statement = (sql, values = []) => ({
    toQuery: () => httpQuery({ sql, values }),
    bind: (...parameters) => statement(sql, parameters),
    async all() {
      const [result] = await query(this.toQuery(), 1);
      return result;
    },
    async first() {
      return (await this.all()).results[0] ?? null;
    },
    async run() {
      return this.all();
    },
  });

  return {
    prepare: statement,
    batch: statements => query({ batch: statements.map(item => item.toQuery()) }, statements.length),
  };
}
