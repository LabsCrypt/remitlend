import swaggerJSDoc from "swagger-jsdoc";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
        description: "Internal-only API key for administrative operations",
      },
    },
    schemas: {
      ErrorResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          message: { type: "string" },
          error: {
            type: "object",
            properties: {
              code: { type: "string" },
              details: { type: "object" },
            },
          },
        },
      },
      UserScore: {
        type: "object",
        properties: {
          success: { type: "boolean", example: true },
          userId: { type: "string" },
          score: { type: "integer", example: 700 },
          band: { type: "string", example: "Good" },
          factors: {
            type: "object",
            properties: {
              repaymentHistory: { type: "string" },
              creditMix: { type: "string" },
            },
          },
        },
      },
      RemittanceHistory: {
        type: "object",
        properties: {
          userId: { type: "string" },
          score: { type: "integer" },
          streak: { type: "integer" },
          history: {
            type: "array",
            items: {
              type: "object",
              properties: {
                paymentId: { type: "string" },
                amount: { type: "number" },
                status: { type: "string" },
                timestamp: { type: "string", format: "date-time" },
              },
            },
          },
        },
      },
    },
  },
};

const options: swaggerJSDoc.Options = {
  swaggerDefinition,
  apis: [
    path.resolve(__dirname, "../routes/*.ts"),
    path.resolve(__dirname, "../routes/*.js"),
  ],
};

export const swaggerSpec = swaggerJSDoc(options);
