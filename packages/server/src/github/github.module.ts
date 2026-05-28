import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { GithubBridgeRegistrar } from './github-bridge-registrar'
import { GithubTestRepoService } from './github-test-repo.service'

@Module({
  imports: [AuthModule],
  providers: [GithubTestRepoService, GithubBridgeRegistrar],
  exports: [GithubTestRepoService],
})
export class GithubModule {}
