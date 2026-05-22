import crypto from 'node:crypto'
import fs from 'node:fs'

/**
 * Helper to compute SHA-256 hash of a file asynchronously.
 */
export function getFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', data => hash.update(data))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', err => reject(err))
  })
}
