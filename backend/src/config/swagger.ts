import path from 'node:path';
import type { Express, NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import swaggerJSDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { swaggerSchemas } from './swaggerSchemas.js';

export function isSwaggerEnabled(): boolean {
  return (
    process.env.NODE_ENV !== 'production' || process.env.ENABLE_SWAGGER?.toLowerCase() === 'true'
  );
}

const cwd = process.cwd();

export const swaggerSpec = swaggerJSDoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'RemitLend API',
      version: '1.0.0',
      description: 'Backend API for RemitLend lending, scoring, remittance, and indexer flows.',
    },
    servers: [
      {
        url: '/api',
        description: 'Legacy API base path',
      },
      {
        url: '/api/v1',
        description: 'Versioned API base path',
      },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
        },
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: swaggerSchemas,
    },
  },
  apis: [
    path.join(cwd, 'src/routes/**/*.{ts,js}'),
    path.join(cwd, 'src/controllers/**/*.{ts,js}'),
    path.join(cwd, 'dist/src/routes/**/*.js'),
    path.join(cwd, 'dist/src/controllers/**/*.js'),
  ],
});

export function mountSwaggerDocs(app: Express): void {
  const docsRouter = Router();
  docsRouter.use(...swaggerUi.serve);
  docsRouter.get('/', swaggerUi.setup(swaggerSpec));

  app.use('/docs', (req: Request, res: Response, next: NextFunction) => {
    if (!isSwaggerEnabled()) {
      next();
      return;
    }

    // Swagger UI requires inline scripts. Override helmet's global script-src
    // with a /docs-scoped policy so API routes stay hardened.
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' https: 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' https: data:; frame-ancestors 'self'",
    );
    docsRouter(req, res, next);
  });

  app.get('/docs.json', (_req: Request, res: Response, next: NextFunction) => {
    if (!isSwaggerEnabled()) {
      next();
      return;
    }

    res.json(swaggerSpec);
  });
}
