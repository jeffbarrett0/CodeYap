import { z } from 'zod'

export const outcomeSchema = z.enum(['success', 'fail', 'neutral'])
export const roleSchema = z.enum(['admin', 'analyst', 'viewer'])

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<typeof schema> {
  const r = schema.safeParse(data)
  if (!r.success) {
    const issue = r.error.issues[0]
    throw new HttpError(400, `${issue.path.join('.') || 'body'}: ${issue.message}`)
  }
  return r.data
}
