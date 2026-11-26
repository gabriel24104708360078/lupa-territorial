/**
 * Ponto de entrada Serverless Function do Vercel (/api/*).
 * Reutiliza a instância Express configurada em src/server/apiApp.ts sem chamar app.listen().
 */

import { createApiApp } from '../src/server/apiApp.ts';

const app = createApiApp();

export default app;
