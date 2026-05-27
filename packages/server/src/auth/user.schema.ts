import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import type { HydratedDocument } from 'mongoose'

export type UserDocument = HydratedDocument<User>

@Schema({ collection: 'users', timestamps: true })
export class User {
  /** GitHub 用户 id，与 JWT / API 中的 user.id 一致 */
  @Prop({ required: true, unique: true })
  githubId!: string

  @Prop({ required: true })
  login!: string

  @Prop()
  name?: string

  @Prop()
  avatarUrl?: string

  @Prop({ required: true, default: 'github' })
  provider!: 'github'

  @Prop({ required: true })
  lastLoginAt!: Date

  /** GitHub OAuth access token，仅服务端用于退出时撤销授权 */
  @Prop({ select: false })
  githubAccessToken?: string

  /** 用户名下 playwright 测试代码仓库，如 `login/playwright-test-code` */
  @Prop()
  playwrightTestRepoFullName?: string
}

export const UserSchema = SchemaFactory.createForClass(User)
UserSchema.index({ login: 1 })
UserSchema.index({ lastLoginAt: -1 })
