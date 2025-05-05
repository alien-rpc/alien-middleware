import { compilePaths, InferParams, PathMatcher } from 'pathic'
import { isArray, isFunction } from 'radashi'
import type { MiddlewareChain, MiddlewareContext } from './index'
import type { RouteHandler, RouteMethod, RouterContext } from './types'

type OneOrMany<T> = T | readonly T[]

export type Router<T extends MiddlewareChain = any> = ReturnType<
  typeof routes<T>
>

export function routes<T extends MiddlewareChain>(middlewares?: T) {
  const paths: string[] = []
  const filters: (((method: RouteMethod) => boolean) | null)[] = []
  const handlers: RouteHandler[] = []

  type Router = typeof router

  function use<TPath extends string>(
    path: TPath,
    handler: RouteHandler<T, InferParams<TPath>>
  ): Router
  function use<TPath extends string, TMethod extends RouteMethod = RouteMethod>(
    method: OneOrMany<TMethod> | '*',
    path: TPath,
    handler: RouteHandler<T, InferParams<TPath>, TMethod>
  ): Router
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
    return router
  }

  let matcher: PathMatcher | undefined

  function router(context: MiddlewareContext<T>) {
    matcher ||= compilePaths(paths)
    const method = context.request.method as RouteMethod
    return matcher(context.request.path, (index, params) => {
      if (!filters[index] || filters[index](method)) {
        context.method = method
        context.params = params

        return middlewares
          ? middlewares.use(handlers[index] as any)(context)
          : handlers[index](context as RouterContext)
      }
    })
  }

  router.use = use
  return router
}
