import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

/** Compteurs en mémoire (par processus) exposés au format Prometheus. Aucune donnée personnelle : méthode, route normalisée, classe de statut. */
const counters = new Map<string, number>();
const sums = { count: 0, seconds: 0 };
const buckets = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
const hist = new Array(buckets.length + 1).fill(0);
const startedAt = Date.now();

/** Remplace les identifiants (UUID, nombres) pour limiter le nombre de séries. */
export const normalizePath = (p: string) =>
  p.split('?')[0].replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id').replace(/\/\d+(?=\/|$)/g, '/:n');

export function observe(method: string, path: string, status: number, seconds: number) {
  const k = `${method}|${normalizePath(path)}|${Math.floor(status / 100)}xx`;
  counters.set(k, (counters.get(k) ?? 0) + 1);
  sums.count++; sums.seconds += seconds;
  let i = buckets.findIndex((b) => seconds <= b);
  if (i < 0) i = buckets.length;
  hist[i]++;
}

export function render(): string {
  const lines = ['# HELP agritrace_http_requests_total Requêtes HTTP', '# TYPE agritrace_http_requests_total counter'];
  for (const [k, v] of counters) {
    const [method, route, status] = k.split('|');
    lines.push(`agritrace_http_requests_total{method="${method}",route="${route}",status="${status}"} ${v}`);
  }
  lines.push('# HELP agritrace_http_request_duration_seconds Durée des requêtes', '# TYPE agritrace_http_request_duration_seconds histogram');
  let cum = 0;
  buckets.forEach((b, i) => { cum += hist[i]; lines.push(`agritrace_http_request_duration_seconds_bucket{le="${b}"} ${cum}`); });
  cum += hist[buckets.length];
  lines.push(`agritrace_http_request_duration_seconds_bucket{le="+Inf"} ${cum}`,
    `agritrace_http_request_duration_seconds_sum ${sums.seconds.toFixed(4)}`, `agritrace_http_request_duration_seconds_count ${sums.count}`,
    '# TYPE agritrace_uptime_seconds gauge', `agritrace_uptime_seconds ${Math.floor((Date.now() - startedAt) / 1000)}`,
    '# TYPE agritrace_process_resident_memory_bytes gauge', `agritrace_process_resident_memory_bytes ${process.memoryUsage().rss}`);
  return lines.join('\n') + '\n';
}

/** Identifiant de requête (X-Request-Id), métriques et journal d'accès JSON (LOG_REQUESTS=true). Jamais de corps, d'en-tête d'autorisation ni de paramètres de requête. */
export function requestMiddleware(logRequests: boolean) {
  return (req: Request, res: Response, next: NextFunction) => {
    const id = randomUUID();
    res.setHeader('X-Request-Id', id);
    const t0 = process.hrtime.bigint();
    res.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - t0) / 1e9;
      const path = normalizePath(req.originalUrl);
      observe(req.method, path, res.statusCode, seconds);
      if (logRequests) console.log(JSON.stringify({ t: new Date().toISOString(), id, method: req.method, path, status: res.statusCode, ms: Math.round(seconds * 1000) }));
    });
    next();
  };
}
