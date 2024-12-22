import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: ['https://v2.print3r.xyz', 'http://localhost:3000'],
    credentials: true,
  });
  await app.listen(3000);
}
bootstrap();
