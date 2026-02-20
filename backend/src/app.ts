import express, { type Request, type Response } from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from "./config/swagger.js";
import simulationRoutes from './routes/simulationRoutes.js';
const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req: Request, res: Response) => {
    res.send('RemitLend Backend is running');
});

app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: Date.now()
    });
});
app.use('/api', simulationRoutes);

app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

export default app;
