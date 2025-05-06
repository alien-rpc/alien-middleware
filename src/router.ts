import { compilePaths, PathMatcher } from 'pathic'
import { isArray, isFunction } from 'radashi'
import type { MiddlewareChain, MiddlewareContext } from './index'
import type {
  EmptyMiddlewareChain,
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
): Router<T> {
  const paths: string[] = []
  const filters: (((method: RouteMethod) => boolean) | null)[] = []
  const handlers: RouteHandler[] = []

  let matcher: PathMatcher | undefined

  function use(
    method: OneOrMany<RouteMethod> | '*' | (string & {}),
    path: string | RouteHandler,
    handler?: RouteHandler
  ) {
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

  function router(context: MiddlewareContext<T>) {
    // Ensure the `url` property exists (e.g. if this is called directly).
    defineParsedURL(context)

    const { request, url } = context as RouteContext
    const method = request.method as RouteMethod

    matcher ||= compilePaths(paths)

    return matcher(url.pathname, (index, params) => {
      if (!filters[index] || filters[index](method)) {
        context.method = method
        context.params = params

        return middlewares
          ? middlewares.use(handlers[index] as any)(context)
          : handlers[index](context as RouteContext)
      }
    })
  }

  router.use = use
  return router as Router<T>
}

export type { RouteContext, RouteHandler, Router } from './types.ts'
