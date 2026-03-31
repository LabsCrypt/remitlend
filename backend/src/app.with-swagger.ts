import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./config/swagger.esm.js";
import app from "./app.js";

// Mount Swagger docs route
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

export default app;
