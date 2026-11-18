import { handleApi } from '../server/api.js';
import { d1Http } from '../server/d1-http.js';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const endpoint = url.searchParams.get('__oqu_endpoint');
    if (endpoint !== null) {
      url.pathname = '/api/' + endpoint;
      url.searchParams.delete('__oqu_endpoint');
    }

    const headers = new Headers(request.headers);
    // Vercel sets this header at the edge. The shared API uses the Cloudflare
    // header name for its per-IP limits.
    headers.delete('cf-connecting-ip');
    const clientIp = headers.get('x-vercel-forwarded-for');
    if (clientIp) headers.set('cf-connecting-ip', clientIp);

    const apiRequest = new Request(url, {
      method: request.method,
      headers,
      ...(request.body ? { body: request.body, duplex: 'half' } : {}),
    });
    return handleApi(apiRequest, { ...process.env, DB: d1Http(process.env) });
  },
};
