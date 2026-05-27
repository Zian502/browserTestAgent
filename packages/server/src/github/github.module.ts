import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { GithubTestRepoService } from './github-test-repo.service'

@Module({
  imports: [AuthModule],
  providers: [GithubTestRepoService],
  exports: [GithubTestRepoService],
})
export class GithubModule {}
