import './load-env'
import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { fileCacheService } from './lib/file-cache'

async function bootstrap() {
  await fileCacheService.init()
  const app = await NestFactory.create(AppModule, { bodyParser: true })
  app.enableCors({ origin: true })
  const port = process.env.PORT ? Number(process.env.PORT) : 3850
  await app.listen(port)
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${port}`)
}

bootstrap()
