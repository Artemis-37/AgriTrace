import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// En développement, /v1 est relayé vers l'API : pas de CORS à ouvrir. En production, servir le portail et l'API sous le même domaine.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/v1': process.env.VITE_API_PROXY ?? 'http://localhost:3000' } },
  test: { environment: 'node' },
});
