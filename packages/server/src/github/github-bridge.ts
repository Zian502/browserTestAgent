import type { GithubTestRepoService } from './github-test-repo.service'

let githubTestRepoService: GithubTestRepoService | null = null

export function registerGithubTestRepoService(service: GithubTestRepoService): void {
  githubTestRepoService = service
}

export function getGithubTestRepoService(): GithubTestRepoService | null {
  return githubTestRepoService
}
