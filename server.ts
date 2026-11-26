/**
 * Servidor local Express do Lupa Territorial (porta 3000).
 * Reutiliza as rotas /api de src/server/apiApp.ts e integra o Vite em desenvolvimento ou dist/ em produção.
 */

import dotenv from 'dotenv';
import express, { type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { createApiApp } from './src/server/apiApp.ts';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

async function bootstrap() {
  const app = createApiApp();

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build não encontrado.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor Lupa Territorial ativo em http://0.0.0.0:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('Falha ao iniciar servidor:', err);
  process.exit(1);
});
