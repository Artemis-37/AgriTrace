import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from './app.module';
import * as http from 'http';
import * as express from 'express';
import { requestMiddleware } from './ops/metrics';
import { ensureCertificate } from './ops/tls';

/** Secrets fournis par fichier (Docker/Kubernetes secrets) : JWT_SECRET_FILE=/run/secrets/jwt → JWT_SECRET. */
function loadSecretFiles() {
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.endsWith('_FILE') || !v || k === 'AGRITRACE_RELEASE_PUBKEY_FILE') continue;
    const target = k.slice(0, -5);
    if (!['JWT_SECRET', 'DATABASE_URL', 'METRICS_TOKEN', 'SECRETS_KEY', 'DOCUMENTS_KEY', 'SMTP_URL', 'BOOTSTRAP_TOKEN'].includes(target) || process.env[target]) continue;
    process.env[target] = fs.readFileSync(v, 'utf8').trim();
  }
}

async function bootstrap() {
  loadSecretFiles();
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('Production : JWT_SECRET de 32 caractères minimum exigé (openssl rand -base64 48)');
    if (/^(change|secret|test|password|dev)/i.test(process.env.JWT_SECRET)) throw new Error('Production : JWT_SECRET trop prévisible');
  }
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 24)
    throw new Error('JWT_SECRET manquant ou trop court (24 caractères minimum)');
  if (process.env.NODE_ENV === 'production' && !process.env.SECRETS_KEY) console.warn('[sécurité] SECRETS_KEY absente : les secrets 2FA sont chiffrés avec une clé dérivée de JWT_SECRET (changer JWT_SECRET les rendrait illisibles). Définissez SECRETS_KEY.');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL manquant');

  // TLS sur le réseau local : TLS_DIR = dossier du certificat auto-signé (créé au premier démarrage). Les postes l'épinglent par son empreinte.
  // HTTP_LOOPBACK_PORT : port HTTP réservé à ce poste (127.0.0.1) pour l'application elle-même, sa surveillance et ses tests.
  const tls = process.env.TLS_DIR ? await ensureCertificate(process.env.TLS_DIR) : null;
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, ...(tls ? { httpsOptions: { key: tls.key, cert: tls.cert } } : {}) });
  // Derrière un reverse proxy (nginx, équilibreur) : TRUST_PROXY=1 pour que l'adresse IP réelle serve au limiteur de débit et à l'audit.
  if (process.env.TRUST_PROXY) (app.getHttpAdapter().getInstance() as any).set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
  // Taille des corps de requête : 2 Mo partout (une requête anonyme ne peut pas saturer la mémoire), plus pour les routes qui reçoivent des lots :
  // synchronisation, réplication (lignes + pièces jointes) et import cartographique.
  const BIG = process.env.AGRITRACE_MODE !== 'local' ? '40mb' : '10mb';
  app.use(['/v1/replication', '/v1/sync', '/v1/geo'], express.json({ limit: BIG }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  // Les réponses de l'API ne sont jamais mises en cache (navigateur partagé, proxy) : elles contiennent des données de la coopérative.
  app.use('/v1', (_req: any, res: any, next: any) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  // Serveur local (poste Windows de la coopérative) : le portail est servi par l'API elle-même, en HTTP sur le réseau local.
  // Le navigateur ne doit alors pas « améliorer » les requêtes en HTTPS (sinon les pages ne chargent plus).
  const webDir = process.env.WEB_DIR;
  app.use(webDir
    ? helmet({ contentSecurityPolicy: { directives: { ...helmet.contentSecurityPolicy.getDefaultDirectives(), 'upgrade-insecure-requests': null } }, hsts: false, crossOriginOpenerPolicy: false, originAgentCluster: false })
    : helmet());
  app.use(requestMiddleware(process.env.LOG_REQUESTS === 'true'));
  app.enableShutdownHooks(); // arrêt propre : les requêtes en cours se terminent, le pool PostgreSQL se ferme
  app.setGlobalPrefix('v1');
  // CORS : uniquement les origines listées (CORS_ORIGINS, séparées par des virgules). Rien par défaut : le portail passe par le même domaine.
  const origins = (process.env.CORS_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  if (origins.length) app.enableCors({ origin: origins, allowedHeaders: ['Authorization', 'Content-Type', 'X-Organization-Id'], exposedHeaders: ['Content-Disposition'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('AgriTrace API')
      .setDescription('La traçabilité agricole, de la parcelle au marché.')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build(),
  );
  // La documentation interactive de l'API n'est pas publiée en production (elle aide un attaquant à cartographier l'API) : ENABLE_API_DOCS=true pour l'activer.
  if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_API_DOCS === 'true') SwaggerModule.setup('v1/docs', app, doc);

  if (webDir) {
    app.useStaticAssets(webDir, { index: false, maxAge: '1h' });
    // Toute adresse du portail (hors API) renvoie la page d'accueil : le routage se fait dans le navigateur.
    (app.getHttpAdapter().getInstance() as any).get(/^\/(?!v1(\/|$)).*/, (_req: any, res: any) => res.sendFile(path.join(webDir, 'index.html')));
  }
  if (tls && process.env.HTTP_LOOPBACK_PORT) {
    await app.init();
    http.createServer(app.getHttpAdapter().getInstance()).listen(Number(process.env.HTTP_LOOPBACK_PORT), '127.0.0.1');
  }
  // HOST=127.0.0.1 : poste unique, non joignable depuis le réseau. Sans HOST : accessible aux autres postes.
  if (process.env.HOST) await app.listen(Number(process.env.PORT ?? 3000), process.env.HOST);
  else await app.listen(Number(process.env.PORT ?? 3000));
}
bootstrap();
