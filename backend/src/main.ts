import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import * as path from 'path';
import { AppModule } from './app.module';
import { requestMiddleware } from './ops/metrics';

async function bootstrap() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 24)
    throw new Error('JWT_SECRET manquant ou trop court (24 caractères minimum)');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL manquant');

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Derrière un reverse proxy (nginx, équilibreur) : TRUST_PROXY=1 pour que l'adresse IP réelle serve au limiteur de débit et à l'audit.
  if (process.env.TRUST_PROXY) (app.getHttpAdapter().getInstance() as any).set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
  // Le central reçoit des lots (lignes + pièces jointes) bien plus gros qu'une requête ordinaire.
  if (process.env.AGRITRACE_MODE !== 'local') app.useBodyParser('json', { limit: '40mb' });
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
  SwaggerModule.setup('v1/docs', app, doc);

  if (webDir) {
    app.useStaticAssets(webDir, { index: false, maxAge: '1h' });
    // Toute adresse du portail (hors API) renvoie la page d'accueil : le routage se fait dans le navigateur.
    (app.getHttpAdapter().getInstance() as any).get(/^\/(?!v1(\/|$)).*/, (_req: any, res: any) => res.sendFile(path.join(webDir, 'index.html')));
  }
  await app.listen(Number(process.env.PORT ?? 3000));
}
bootstrap();
