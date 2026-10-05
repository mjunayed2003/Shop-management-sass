import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import morgan from 'morgan';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule);

  // Enable CORS
  app.enableCors();

  // Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Terminal HTTP Request Logger
  app.use(morgan('dev'));

  // Swagger (OpenAPI) Setup
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Shop Management SaaS API')
    .setDescription('REST API documentation for Shop Management SaaS backend')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  const port = process.env.PORT ?? 4000;
  await app.listen(port);

  logger.log(`🚀 Server is running on: http://localhost:${port}`);
  logger.log(`📚 Swagger Docs available at: http://localhost:${port}/api/docs`);
}

await bootstrap();

