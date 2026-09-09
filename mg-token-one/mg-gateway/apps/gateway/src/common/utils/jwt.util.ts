import * as jwt from 'jsonwebtoken'

export interface JwtPayload {
  sub: number // userId
  role: string
  username: string
  identitySubject?: string
  identitySession?: string
}

export class JwtUtil {
  static sign(payload: JwtPayload, secret: string, expiresIn: string): string {
    return jwt.sign(payload, secret, { expiresIn } as jwt.SignOptions)
  }

  static verify(token: string, secret: string): JwtPayload {
    return jwt.verify(token, secret) as unknown as JwtPayload
  }
}
