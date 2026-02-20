import request from 'supertest';
import app from '../app.js';

describe('GET /health', () => {
    it('should return status ok with 200', async () => {
        const response = await request(app).get('/health');

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('status', 'ok');
    });

    it('should return uptime as a number', async () => {
        const response = await request(app).get('/health');

        expect(response.body).toHaveProperty('uptime');
        expect(typeof response.body.uptime).toBe('number');
    });

    it('should return timestamp as a number', async () => {
        const response = await request(app).get('/health');

        expect(response.body).toHaveProperty('timestamp');
        expect(typeof response.body.timestamp).toBe('number');
    });
});
