import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import type { Model } from 'mongoose'
import type { AuthUser } from './auth.types'
import { User, type UserDocument } from './user.schema'

@Injectable()
export class UserService {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  async upsertFromGithub(profile: AuthUser, githubAccessToken?: string): Promise<AuthUser> {
    const now = new Date()
    const $set: Record<string, unknown> = {
      login: profile.login,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      provider: 'github' as const,
      lastLoginAt: now,
    }
    if (githubAccessToken) {
      $set.githubAccessToken = githubAccessToken
    }

    const doc = await this.users
      .findOneAndUpdate(
        { githubId: profile.id },
        {
          $set,
          $setOnInsert: { githubId: profile.id },
        },
        { upsert: true, new: true },
      )
      .exec()

    return this.toAuthUser(doc)
  }

  async revokeGithubAuthorization(
    githubId: string,
    credentials: { clientId: string; clientSecret: string },
  ): Promise<void> {
    const doc = await this.users.findOne({ githubId }).select('githubAccessToken').exec()
    const githubAccessToken = doc?.githubAccessToken?.trim()

    if (githubAccessToken && credentials.clientId && credentials.clientSecret) {
      const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64')
      try {
        await fetch(`https://api.github.com/applications/${credentials.clientId}/token`, {
          method: 'DELETE',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Basic ${basic}`,
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          body: JSON.stringify({ access_token: githubAccessToken }),
        })
      } catch {
        // 撤销失败仍清除本地记录，避免阻塞退出
      }
    }

    await this.users.updateOne({ githubId }, { $unset: { githubAccessToken: '' } }).exec()
  }

  async findByGithubId(githubId: string): Promise<AuthUser | null> {
    const doc = await this.users.findOne({ githubId }).exec()
    return doc ? this.toAuthUser(doc) : null
  }

  async getGithubCredentials(githubId: string): Promise<{ token: string; login: string } | null> {
    const id = githubId.trim()
    if (!id) return null
    const doc = await this.users.findOne({ githubId: id }).select('githubAccessToken login').exec()
    const token = doc?.githubAccessToken?.trim()
    const login = doc?.login?.trim()
    if (!token || !login) return null
    return { token, login }
  }

  async savePlaywrightTestRepoFullName(githubId: string, repoFullName: string): Promise<void> {
    const id = githubId.trim()
    const name = repoFullName.trim()
    if (!id || !name) return
    await this.users.updateOne({ githubId: id }, { $set: { playwrightTestRepoFullName: name } }).exec()
  }

  private toAuthUser(doc: UserDocument): AuthUser {
    return {
      id: doc.githubId,
      login: doc.login,
      name: doc.name,
      avatarUrl: doc.avatarUrl,
    }
  }
}
