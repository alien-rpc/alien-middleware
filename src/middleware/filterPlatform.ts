import { RequestContext } from '../types.ts'

export function filterPlatform<TPlatform extends { name: string }>(
  name: TPlatform['name']
) {
  return function (ctx: RequestContext): { platform: TPlatform } {
    if (ctx.platform.name !== name) {
      return ctx.passThrough()
    }
    // Nothing to do at runtime when overriding the platform type.
    return null!
  }
}
