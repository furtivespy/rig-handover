import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { readNight } from '../src/digest/read.js';

// Fixture night: one job retried 3 times then ok, one that fails, one with owner null,
// one calm job, and a truncated (unparseable) last line.
const FIXTURE_NIGHT = '2026-10-20';
const EMPTY_NIGHT = '2026-10-21';
const MISSING_NIGHT = '2026-10-22';

const FIXTURE_LINES = [
  '{"at":"2026-10-20T23:00:01+01:00","job":"alpha/flaky","status":"retry","owner":"rook","error":"timeout"}',
  '{"at":"2026-10-20T23:01:01+01:00","job":"alpha/flaky","status":"retry","owner":"rook","error":"timeout"}',
  '{"at":"2026-10-20T23:02:01+01:00","job":"alpha/flaky","status":"retry","owner":"rook","error":"timeout"}',
  '{"at":"2026-10-20T23:03:01+01:00","job":"alpha/flaky","status":"ok","owner":"rook"}',
  '{"at":"2026-10-20T23:04:00+01:00","job":"beta/broken","status":"fail","owner":"lane-07","error":"boom"}',
  '{"at":"2026-10-20T23:05:00+01:00","job":"gamma/orphan","status":"retry","owner":null,"error":"slow"}',
  '{"at":"2026-10-20T23:06:00+01:00","job":"gamma/orphan","status":"ok","owner":null}',
  '{"at":"2026-10-20T23:07:00+01:00","job":"delta/steady","status":"ok","owner":"rook"}',
  '{"at":"2026-10-20T23:08:00+01:00","job":"zeta/trunc","stat',
];
// Sorted by job, as readNight returns them.
const JOBS_IN_ORDER = ['alpha/flaky', 'beta/broken', 'delta/steady', 'gamma/orphan'];

let runsDir: string;

function makeApp() {
  return createApp({ adapter: 'shim', installed: 'x', beatEverySeconds: 60, runsDir });
}

// The opening <tr ...> tag of the row that mentions `job`.
function rowOf(html: string, job: string): { open: string; body: string } {
  const segment = html.split('<tr').slice(1).find((s) => s.includes(job));
  if (segment === undefined) throw new Error(`no <tr> mentions ${job}`);
  const end = segment.indexOf('>');
  return { open: segment.slice(0, end + 1), body: segment };
}

beforeAll(() => {
  runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-digest-routes-'));
  fs.writeFileSync(path.join(runsDir, `${FIXTURE_NIGHT}.jsonl`), FIXTURE_LINES.join('\n'));
  fs.writeFileSync(path.join(runsDir, `${EMPTY_NIGHT}.jsonl`), '');
});

afterAll(() => {
  fs.rmSync(runsDir, { recursive: true, force: true });
});

describe('digest page GET /digest/:night', () => {
  it('200 with every job name for a night with a file', async () => {
    const res = await makeApp().request(`/digest/${FIXTURE_NIGHT}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    for (const job of JOBS_IN_ORDER) expect(html).toContain(job);
  });

  it('marks rows with retries >= 3 or a failed last status with class="warn"', async () => {
    const html = await (await makeApp().request(`/digest/${FIXTURE_NIGHT}`)).text();
    expect(rowOf(html, 'alpha/flaky').open).toContain('class="warn"'); // 3 retries, then ok
    expect(rowOf(html, 'beta/broken').open).toContain('class="warn"'); // last status fail
    expect(rowOf(html, 'delta/steady').open).not.toContain('warn');
    expect(rowOf(html, 'gamma/orphan').open).not.toContain('warn'); // 1 retry, ends ok
  });

  it('renders a null owner as —', async () => {
    const html = await (await makeApp().request(`/digest/${FIXTURE_NIGHT}`)).text();
    expect(rowOf(html, 'gamma/orphan').body).toContain('—');
    // alpha/flaky has an owner and an error, so nothing in its row is missing.
    expect(rowOf(html, 'alpha/flaky').body).not.toContain('—');
  });

  it('404 for a night with no file', async () => {
    const res = await makeApp().request(`/digest/${MISSING_NIGHT}`);
    expect(res.status).toBe(404);
  });

  it('empty file → 200 and says nothing ran', async () => {
    const res = await makeApp().request(`/digest/${EMPTY_NIGHT}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('night with a bad line → 200 and counts the unreadable line', async () => {
    const res = await makeApp().request(`/digest/${FIXTURE_NIGHT}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('unreadable lines: 1');
  });
});

describe('digest JSON GET /api/digest/:night', () => {
  it('200 with { night, rows, counts, badLines } exactly as readNight returns', async () => {
    const res = await makeApp().request(`/api/digest/${FIXTURE_NIGHT}`);
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    const expected = readNight(runsDir, FIXTURE_NIGHT);
    expect(expected).not.toBeNull();
    expect(body).toEqual(expected);
    expect(Object.keys(body as object).sort()).toEqual(['badLines', 'counts', 'night', 'rows']);
  });

  it('rows are sorted by job and a null owner stays null', async () => {
    const body = (await (await makeApp().request(`/api/digest/${FIXTURE_NIGHT}`)).json()) as {
      night: string;
      rows: { job: string; owner: string | null }[];
    };
    expect(body.night).toBe(FIXTURE_NIGHT);
    expect(body.rows.map((r) => r.job)).toEqual(JOBS_IN_ORDER);
    expect(body.rows.find((r) => r.job === 'gamma/orphan')?.owner).toBeNull();
  });

  it('404 with { error } for a night with no file', async () => {
    const res = await makeApp().request(`/api/digest/${MISSING_NIGHT}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: `no run log for ${MISSING_NIGHT}` });
  });

  it('empty file → 200 with rows []', async () => {
    const res = await makeApp().request(`/api/digest/${EMPTY_NIGHT}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[] };
    expect(body.rows).toEqual([]);
  });

  it('bad line → badLines 1 and the other rows still present', async () => {
    const res = await makeApp().request(`/api/digest/${FIXTURE_NIGHT}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { badLines: number; rows: { job: string }[] };
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(JOBS_IN_ORDER);
  });
});

describe('page and JSON agree', () => {
  it('job names in the page, in document order, equal the JSON rows in order', async () => {
    const app = makeApp();
    const html = await (await app.request(`/digest/${FIXTURE_NIGHT}`)).text();
    const json = (await (await app.request(`/api/digest/${FIXTURE_NIGHT}`)).json()) as {
      rows: { job: string }[];
    };
    const jsonJobs = json.rows.map((r) => r.job);
    const inPage = jsonJobs
      .map((job) => ({ job, at: html.indexOf(job) }))
      .filter((p) => p.at >= 0)
      .sort((a, b) => a.at - b.at)
      .map((p) => p.job);
    expect(inPage).toEqual(jsonJobs);
    // The unreadable line's job never became a row, so it must not show up either.
    expect(html).not.toContain('zeta/trunc');
  });
});
