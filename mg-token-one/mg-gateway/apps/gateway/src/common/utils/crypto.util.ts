import * as crypto from 'crypto'

const ALGO = 'aes-256-gcm'

function getKey(secret: string): Buffer {
  // 派生 32 字节 key
  return crypto.createHash('sha256').update(String(secret)).digest()
}

export class CryptoUtil {
  /** 渠道 key 加密（一行一个 → 密文块）*/
  static encrypt(plain: string, secret: string): string {
    const key = getKey(secret)
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv(ALGO, key, iv)
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return Buffer.concat([iv, tag, enc]).toString('base64')
  }

  static decrypt(b64: string, secret: string): string {
    const key = getKey(secret)
    const buf = Buffer.from(b64, 'base64')
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(12, 28)
    const enc = buf.subarray(28)
    const decipher = crypto.createDecipheriv(ALGO, key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
  }

  static sha256(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex')
  }

  /** 解析多行 key 文本为数组 */
  static splitKeys(text: string): string[] {
    return text
      .split(/\r?\n/)
      .map((k) => k.trim())
      .filter(Boolean)
  }
}
