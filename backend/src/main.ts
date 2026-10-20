import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 24)
    throw new Error('JWT_SECRET manquant ou trop court (24 caractères minimum)');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL manquant');

  const app = await NestFactory.create(AppModule);
  app.use(helmet());
  app.setGlobalPrefix('v1');
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

  await app.listen(Number(process.env.PORT ?? 3000));
}
bootstrap();
