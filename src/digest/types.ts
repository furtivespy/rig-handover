// Plan morning-digest § 1. The contract every part of § 2 builds against.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One line of runs/<night>.jsonl, after parsing.
export type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

// One row per job. Times keep the offset from the log; never converted to UTC.
export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  lastError: string | null;
  first: string;
  last: string;
};

export type StatusCounts = Record<RunStatus, number>;

export type Night = {
  night: string;
  // Sorted by job. The page and the JSON both render this order (ADR 0001).
  rows: DigestRow[];
  // Lines counted per status, across all jobs.
  counts: StatusCounts;
  // Lines that didn't parse. Counted, never thrown.
  badLines: number;
};

// null when runs/<night>.jsonl doesn't exist. An empty file is a Night with no rows.
export type ReadNight = (runsDir: string, night: string) => Night | null;
