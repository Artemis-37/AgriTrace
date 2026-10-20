import { normalizePath, observe, render } from './metrics';

describe('métriques', () => {
  it('normalise les identifiants dans les routes', () => {
    expect(normalizePath('/v1/loans/3f2b8a0e-1111-4222-8333-444455556666/repayments?x=1')).toBe('/v1/loans/:id/repayments');
    expect(normalizePath('/v1/page/12')).toBe('/v1/page/:n');
  });
  it('expose compteurs et histogramme sans donnée personnelle', () => {
    observe('GET', '/v1/producers', 200, 0.03);
    observe('GET', '/v1/producers', 500, 3);
    const out = render();
    expect(out).toContain('agritrace_http_requests_total{method="GET",route="/v1/producers",status="2xx"} 1');
    expect(out).toContain('status="5xx"');
    expect(out).toContain('agritrace_http_request_duration_seconds_count 2');
    expect(out).toContain('le="+Inf"} 2');
  });
});
