import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const config = { adapter: 'shim', installed: 'x', beatEverySeconds: 60, runsDir: 'runs' };

describe('digest page', () => {
  it('renders the night with warn rows and the unreadable count', async () => {
    const res = await createApp(config).request('/digest/2026-10-28');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('<title>rig · digest · 2026-10-28</title>');
    expect(html.match(/<tbody>[\s\S]*<\/tbody>/)?.[0].match(/<tr/g)).toHaveLength(5);
    expect(html).toMatch(/<tr class="warn"><td>fixtures\/refresh<\/td>/);
    expect(html).toMatch(/<tr class="warn"><td>notes\/backup<\/td>/);
    expect(html).not.toMatch(/<tr class="warn"><td>lane\/sync<\/td>/);
    expect(html).toContain('unreadable lines: 1');
    expect(html).toContain('2026-10-29T01:30:00+01:00');
    expect(html).toContain('<td>—</td>');
  });

  it('404s on a night with no log', async () => {
    const res = await createApp(config).request('/digest/2020-01-01');
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('no run log for 2020-01-01');
  });
});
