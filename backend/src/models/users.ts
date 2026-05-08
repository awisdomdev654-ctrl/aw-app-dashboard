import mongoose, { Schema } from 'mongoose'

export interface UserDoc {
  userId: string
  email: string
  password: string
  createdAt: Date
  updatedAt: Date
}

const UserSchema = new Schema<UserDoc>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
  },
  { timestamps: true },
)

export const UserModel =
  mongoose.models.User ?? mongoose.model<UserDoc>('User', UserSchema)
