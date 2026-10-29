import { PrismaClient } from '@prisma/client'

// BigInt columns (file sizes) → JSON numbers. Files > 2^53 bytes are not a concern.
;(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function (this: bigint) {
  return Number(this)
}

export const prisma = new PrismaClient()
