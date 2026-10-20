import express from 'express';
import request from 'supertest';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

describe('Express Trust Proxy & Rate Limiting IP Resolution (Issue #1069)', () => {
  describe('Trust Proxy IP Resolution', () => {
    it('resolves real client IP from X-Forwarded-For when trust proxy is enabled (1 hop)', async () => {
      const app = express();
      app.set('trust proxy', 1);

      app.get('/test-ip', (req, res) => {
        res.json({
          ip: req.ip,
          ips: req.ips,
        });
      });

      const res = await request(app)
        .get('/test-ip')
        .set('X-Forwarded-For', '203.0.113.195, 10.0.0.1');

      expect(res.status).toBe(200);
      expect(res.body.ip).toBe('203.0.113.195');
    });

    it('does not trust spoofed X-Forwarded-For when trust proxy is disabled', async () => {
      const app = express();
      app.set('trust proxy', false);

      app.get('/test-ip', (req, res) => {
        res.json({
          ip: req.ip,
        });
      });

      const res = await request(app)
        .get('/test-ip')
        .set('X-Forwarded-For', '203.0.113.195');

      expect(res.status).toBe(200);
      // Behind false, req.ip will not be the spoofed 203.0.113.195 (defaults to supertest localhost IP ::ffff:127.0.0.1 or 127.0.0.1)
      expect(res.body.ip).not.toBe('203.0.113.195');
    });
  });

  describe('Rate Limiter Per-Client IP Isolation Behind Proxy', () => {
    it('isolates rate-limit counters per distinct client IP behind reverse proxy', async () => {
      const app = express();
      app.set('trust proxy', 1);

      const limiter = rateLimit({
        windowMs: 60 * 1000,
        max: 2,
        keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown'),
        standardHeaders: true,
        legacyHeaders: false,
      });

      app.use('/limited', limiter);
      app.get('/limited', (req, res) => {
        res.json({ success: true, ip: req.ip });
      });

      // Client A makes 2 requests (allowed)
      const resA1 = await request(app)
        .get('/limited')
        .set('X-Forwarded-For', '198.51.100.1, 10.0.0.1');
      expect(resA1.status).toBe(200);

      const resA2 = await request(app)
        .get('/limited')
        .set('X-Forwarded-For', '198.51.100.1, 10.0.0.1');
      expect(resA2.status).toBe(200);

      // Client A makes 3rd request (rate limited)
      const resA3 = await request(app)
        .get('/limited')
        .set('X-Forwarded-For', '198.51.100.1, 10.0.0.1');
      expect(resA3.status).toBe(429);

      // Client B from a different IP is NOT blocked by Client A's rate limit
      const resB1 = await request(app)
        .get('/limited')
        .set('X-Forwarded-For', '198.51.100.2, 10.0.0.1');
      expect(resB1.status).toBe(200);
    });
  });
});
