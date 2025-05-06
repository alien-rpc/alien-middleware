import { compilePaths, PathMatcher } from 'pathic'
import { isArray, isFunction } from 'radashi'
import { chain, type MiddlewareChain, type MiddlewareContext } from './index'
import type {
  EmptyMiddlewareChain,
  RequestContext,
  RouteContext,
  RouteHandler,
  RouteMethod,
  Router,
} from './types'
import { OneOrMany } from './types/common.ts'
import { defineParsedURL } from './url.ts'

export type RouterContext<TRouter extends Router> =
  TRouter extends Router<infer T> ? MiddlewareContext<T> : never

export function routes<T extends MiddlewareChain = EmptyMiddlewareChain>(
  middlewares?: T
): Router<T>

export function routes(middlewares?: MiddlewareChain): Router {
  const paths: string[] = []
  const filters: (((method: RouteMethod) => boolean) | null)[] = []
  const handlers: RouteHandler[] = []

  let matcher: PathMatcher | undefined

  type InternalContext = RequestContext & {
    method?: RouteMethod
    params?: Record<string, string>
  }

  function handle(context: InternalContext) {
    const method = context.request.method as RouteMethod

    // Ensure the `url` property exists (e.g. if this is called directly).
    defineParsedURL(context)

    matcher ||= compilePaths(paths)

    return matcher(context.url.pathname, (index, params) => {
      if (!filters[index] || filters[index](method)) {
        context.method = method
        context.params = params

        return handlers[index](context as RouteContext)
      }
    })
  }

  const run = middlewares?.use(handle) ?? chain(handle)

  function router(context: InternalContext) {
    return run(context)
  }

  router.use = (
    method: OneOrMany<RouteMethod> | '*' | (string & {}),
    path: string | RouteHandler,
    handler?: RouteHandler
  ) => {
    if (isFunction(path)) {
      paths.push(method as string)
      filters.push(null)
      handlers.push(path)
    } else {
      paths.push(path)
      filters.push(
        method === '*'
          ? null
          : isArray(method)
            ? m => method.includes(m)
            : m => method === m
      )
      handlers.push(handler!)
    }
    matcher = undefined
    return router
  }

  return router as Router
}

export type { RouteContext, RouteHandler, Router } from './types.ts'
