import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { registerGithubTestRepoService } from './github-bridge'
import { GithubTestRepoService } from './github-test-repo.service'

/** 在 Nest 模块初始化时注册 GitHub 服务，供 LangGraph agent 通过 bridge 调用 */
@Injectable()
export class GithubBridgeRegistrar implements OnModuleInit {
  private readonly log = new Logger(GithubBridgeRegistrar.name)

  constructor(private readonly githubTestRepoService: GithubTestRepoService) {}

  onModuleInit(): void {
    registerGithubTestRepoService(this.githubTestRepoService)
    this.log.log('GitHub 测试仓库服务已注册')
  }
}
