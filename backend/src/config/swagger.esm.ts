import swaggerJSDoc from "swagger-jsdoc";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { swaggerSchemas } from "./swaggerSchemas.js";

const swaggerDefinition = {
  openapi: "3.0.0",
  info: {
    title: "RemitLend API",
    version: "1.0.0",
    description: "API documentation for RemitLend backend",
  },
  servers: [
    {
      url: "http://localhost:3001/api",
      description: "Development server",
    },
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "x-api-key",
        description:
          "Internal API key (`INTERNAL_API_KEY`) for score workers, webhooks, and admin operations",
      },
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description:
          "JWT issued by POST /api/auth/login after POST /api/auth/challenge + signed message; use on GET /api/auth/verify and protected routes. Payload includes Stellar `publicKey`.",
      },
    },
    schemas: swaggerSchemas,
  },
};

const __swaggerFilename = fileURLToPath(import.meta.url);
const __swaggerDirname = dirname(__swaggerFilename);

export const swaggerSpec = swaggerJSDoc({
  swaggerDefinition,
  apis: [
    path.resolve(__swaggerDirname, "../routes/*.ts"),
    path.resolve(__swaggerDirname, "../routes/*.js"),
  ],
});
