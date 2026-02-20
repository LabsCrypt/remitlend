import express, { type Request, type Response } from 'express';
import cors from 'cors';
import simulationRoutes from './routes/simulationRoutes.js';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from "./config/swagger.js";
import {globalRateLimiter} from './middleware/rateLimiter.js';

const app = express();

app.use(cors());
app.use(express.json());
app.use(globalRateLimiter);

app.get('/', (req: Request, res: Response) => {
    res.send('RemitLend Backend is running');
});

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: Date.now()
    });
});

app.use('/api', simulationRoutes);

app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

export default app;
