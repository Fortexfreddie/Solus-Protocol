/**
 * app.ts
 * Express application setup for Solus Protocol.
 *
 * Configures middleware, mounts routes, sets up Swagger docs, Socket.io,
 * and exports the HTTP server for use by index.ts.
 */

import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import swaggerUi from 'swagger-ui-express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import agentRoutes from './api/routes/agent.routes';
import { eventBus } from './events/event-bus.js';
import { getAuditLogger } from './security/audit-logger.js';

//  Constants 

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:3000';

//  Load Swagger spec 

// Read at startup. Uses __dirname which is available in CJS output (NodeNext module).
const swaggerPath = join(__dirname, '..', 'docs', 'swagger.json');
const swaggerDocument = JSON.parse(readFileSync(swaggerPath, 'utf-8')) as Record<string, unknown>;

//  Express + HTTP + Socket.io 

const app: Application = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: CORS_ORIGIN, methods: ['GET', 'POST'] },
});

//  Middleware 

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

//  Swagger Documentation 

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

//  Routes 

app.use(agentRoutes);

//  Socket.io 

eventBus.init(io);

io.on('connection', (socket) => {
  const logger = getAuditLogger();
  logger.log({
    agentId: 'rex', cycle: 0, event: 'WS_CONNECT',
    data: { socketId: socket.id },
  });

  socket.on('disconnect', () => {
    logger.log({
      agentId: 'rex', cycle: 0, event: 'WS_DISCONNECT',
      data: { socketId: socket.id },
    });
  });
});

//  404 fallback 

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

//  Global error handler 

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : 'Internal server error';
  const stack = process.env.NODE_ENV === 'development' && err instanceof Error ? err.stack : undefined;
  res.status(500).json({ error: message, ...(stack ? { stack } : {}) });
});

//  Server start helper 

function startServer(): Promise<void> {
  return new Promise((resolve) => {
    httpServer.listen(PORT, () => resolve());
  });
}

export { app, io, httpServer, startServer, PORT };
