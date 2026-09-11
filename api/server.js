import express from 'express';
import pg from 'pg';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('FATAL: DATABASE_URL is not set');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});
pool.on('error', (err) => console.error('pg pool error:', err.message));

const app = express();
app.set('trust proxy', true); // behind Traefik
app.use(express.json({ limit: '16kb' }));

const PORT = Number(process.env.PORT) || 3000;

/* ------------------------------------------------------------------ */
/* crude in-memory rate limit: MAX_PER_WINDOW posts per IP per window  */
/* ------------------------------------------------------------------ */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of hits) {
    const keep = arr.filter((t) => now - t < WINDOW_MS);
    if (keep.length) hits.set(ip, keep);
    else hits.delete(ip);
  }
}, WINDOW_MS).unref();

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return str(xff || req.ip || '', 64) || null;
}

/* ------------------------------------------------------------------ */
/* routes                                                             */
/* ------------------------------------------------------------------ */
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('select 1');
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('health check failed:', err.message);
    res.status(503).json({ status: 'db_unavailable' });
  }
});

app.post('/api/contact', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const ip = clientIp(req);

  // Honeypot: real users never fill this hidden field. Pretend success, store nothing.
  if (str(body.company_website, 200)) {
    return res.json({ result: 'success' });
  }

  if (rateLimited(ip || 'unknown')) {
    return res.status(429).json({ result: 'error', error: 'rate_limited' });
  }

  const row = {
    audience: str(body.audience, 60) || 'Unknown',
    name: str(body.name, 200),
    email: str(body.email, 320),
    institution: str(body.institution, 300),
    role: str(body.role, 200),
    cohort_size: str(body.cohortSize, 40) || null,
    simulation: str(body.simulation, 60) || null,
    message: str(body.message, 4000) || null,
  };

  if (!row.name || !EMAIL_RE.test(row.email) || !row.institution || !row.role) {
    return res.status(400).json({ result: 'error', error: 'invalid_input' });
  }

  try {
    await pool.query(
      `insert into contact_submissions
         (audience, name, email, institution, role, cohort_size, simulation, message, ip, user_agent)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        row.audience,
        row.name,
        row.email,
        row.institution,
        row.role,
        row.cohort_size,
        row.simulation,
        row.message,
        ip,
        str(req.headers['user-agent'], 500) || null,
      ],
    );
    res.json({ result: 'success' });
  } catch (err) {
    console.error('insert failed:', err.message);
    res.status(500).json({ result: 'error', error: 'server_error' });
  }
});

// Anything else under /api
app.use('/api', (_req, res) => res.status(404).json({ result: 'error', error: 'not_found' }));

const server = app.listen(PORT, () => console.log(`contact-api listening on :${PORT}`));

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(() => pool.end().finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
