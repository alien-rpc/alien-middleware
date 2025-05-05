# alien-middleware

Reusable middleware chains with top-notch TypeScript support. Built upon [Hattip](https://github.com/hattipjs/hattip) to avoid vendor lock-in using Web Standard APIs.

## Philosophy

By default, middlewares in `alien-middleware` are **synchronous** or **promise-based**. There is no `next()` function to call. If a middleware returns a `Response`, the chain is terminated. If a middleware wants to extend the request context, it returns an object implementing the `RequestPlugin` interface.

Middlewares are either **request-oriented** (the default) or **response-oriented**. Response-oriented middlewares run _after_ a `Response` has been generated. They're allowed to return a new `Response`, but cannot return a `RequestPlugin` object.

## Quick Start

First, add the package to your project:

```bash
pnpm add alien-middleware
```

### Creating a Chain

Import the `chain` function and initialize a middleware chain. You can optionally provide an initial middleware directly to `chain`.

```typescript
import { chain } from 'alien-middleware'

// Create an empty chain
const app = chain()

// Or create a chain with an initial middleware
const appWithInitial = chain(context => {
  console.log('Initial middleware running for:', context.request.url)
})
```

### Adding Middleware with `.use()`

Use the `.use()` method to add middleware functions to the chain. Each call to `.use()` returns a _new_, immutable chain instance.

```typescript
import type { RequestContext } from 'alien-middleware'

const firstMiddleware = (context: RequestContext) => {
  console.log('First middleware')
  // Doesn't return anything, so the chain continues
}

const secondMiddleware = (context: RequestContext) => {
  console.log('Second middleware')
  return new Response('Hello from middleware!', { status: 200 })
  // Returns a Response, terminating the request-phase chain
}

// Add middleware sequentially
const app = chain().use(firstMiddleware).use(secondMiddleware)
```

> [!NOTE]
> Middleware chains are immutable. Each call to `.use()` returns a new chain instance.

### Executing the Chain

To run the middleware chain, pass it to a Hattip adapter like the [Node adapter](https://www.npmjs.com/package/@hattip/adapter-node). The middleware chain is a valid Hattip handler.

```typescript
import { createServer } from '@hattip/adapter-node'

const app = chain()
  .use(mySessionMiddleware)
  .use(myAuthMiddleware)
  .use(myLoggerMiddleware)

// Create a server
const server = createServer(app)

// Start the server
server.listen(3000, () => {
  console.log('Server is running on port 3000')
})
```

> [!NOTE]
> If no middleware in the chain returns a `Response`, a `404 Not Found` response
> is automatically returned.

#### Middlewares are deduplicated.

If you add the same middleware multiple times, it will only run once. This is a safety measure that allows you to use the same middleware in different places without worrying about it running multiple times.

```typescript
const app = chain().use(myMiddleware).use(myMiddleware)
```

### Request Middleware

Request middleware runs sequentially before a `Response` is generated.

- **Terminating the Chain:** Return a `Response` object to stop processing subsequent request middleware.

  ```typescript
  import type { RequestContext } from 'alien-middleware'

  const earlyResponder = (context: RequestContext) => {
    if (context.request.url.endsWith('/forbidden')) {
      return new Response('Forbidden', { status: 403 })
    }
    // Otherwise, continue the chain
  }
  ```

- **Extending Context:** Return an object (known as a "request plugin") to add its properties to the context for _downstream_ middleware. Getter syntax is supported.

  ```typescript
  import type { RequestContext } from 'alien-middleware'

  type User = { id: number; name: string }

  const addUser = (context: RequestContext) => {
    // In a real app, you might look up a user based on a token
    const user: User = { id: 1, name: 'Alice' }

    return { user }
  }

  const greetUser = (context: RequestContext<{ user: User }>) => {
    // The `user` property is now available thanks to `addUser`
    return new Response(`Hello, ${context.user.name}!`)
  }

  const app = chain().use(addUser).use(greetUser)
  ```

- **Extending Environment:** Request plugins may have an `env` property to add environment variables accessible via `context.env()`.

  ```typescript
  import type { RequestContext } from 'alien-middleware'

  const addApiKey = (context: RequestContext) => {
    return { env: { API_KEY: 'secret123' } }
  }

  const useApiKey = (context: RequestContext<never, { API_KEY: string }>) => {
    const key = context.env('API_KEY')
    console.log('API Key:', key) // Output: API Key: secret123
  }

  const app = chain().use(addApiKey).use(useApiKey)
  ```

> [!NOTE]
> If you're wondering why you need to return an object to define properties
> (rather than simply assigning to the context object), it's because TypeScript
> is unable to infer the type of the context object downstream if you don't do
> it like this.
>
> Another thing to note is you don't typically define middlewares outside the
> `.use(…)` call expression, since that requires you to unnecessarily declare
> the type of the context object. It's better to define them inline.

### Response Middleware

Response middleware runs _after_ a `Response` has been generated by a request middleware or the final handler. It receives both the context and the generated `Response`.

```typescript
const poweredByMiddleware = (context: RequestContext, response: Response) => {
  response.headers.set('X-Powered-By', 'alien-middleware')
}

const mainHandler = (context: RequestContext) => {
  return new Response('Main content')
}

// `poweredByMiddleware` runs after `mainHandler` generates a response
const app = chain().use(mainHandler).use(poweredByMiddleware)

const response = await app({…})
console.log(response.headers.get('X-Powered-By')) // Output: alien-middleware
```

> [!NOTE]
> Response middleware cannot extend the context using `{ define }` or `{ env }`.
> They can only inspect the `Response` or replace it by returning a new
> `Response`.

Your response middlewares will run even if no `Response` is generated by the
request middlewares, **except** when the middleware chain is nested inside
another chain, since the outer chain will still have a chance to return a
`Response`.

### Nesting Chains

You can compose middleware by nesting chains using `.use()`. _Request plugins_ within a nested chain are scoped to that chain and do not affect middleware outside of it.

```typescript
const innerChain = chain((context: RequestContext) => {
  console.log('Inner chain start')
  return { define: { innerData: 'secret' } } // Only available inside innerChain
}).use((context: RequestContext<{ innerData: string }>) => {
  console.log('Accessing inner data:', context.innerData)
})

const outerMiddleware = (context: RequestContext) => {
  // context.innerData is not accessible here
  console.log('Outer middleware after inner chain')
  if (!('innerData' in context)) {
    console.log('innerData is correctly scoped.')
  }
  return new Response('Finished')
}

const finalApp = chain().use(innerChain).use(outerMiddleware)
// Output when executing the finalApp chain:
//   Inner chain start
//   Accessing inner data: secret
//   Outer middleware after inner chain
//   innerData is correctly scoped.
```

#### Escaping a Nested Chain

To escape a nested chain, use the `context.passThrough()` method. The outer chain will continue execution with the next middleware.

### Isolated Chains

When nesting a middleware chain in another, you can isolate the nested chain from the outer chain by calling `.isolate()`.

```typescript
const isolatedChain = chain().isolate()
```

This prevents the nested chain from affecting middleware in the outer chain (e.g. through _request plugins_).

```typescript
const innerChain = chain()
  .use(() => ({
    foo: true,
  }))
  .use(ctx => {
    ctx.foo // Output: true
  })

const outerChain = chain()
  .use(innerChain.isolate())
  .use(ctx => {
    ctx.foo // Output: undefined
  })
```

If an isolated chain does not return a `Response`, execution continues with the next middleware in the outer chain.

### Safe Environment Variables

When writing a Hattip handler without this package, the `context.env()` method is inherently unsafe. Its return type is always `string | undefined`, which means you either need to write defensive checks or use type assertions. Neither is ideal.

With alien-middleware, you **must** declare an environment variable's type in order to use it.

```typescript
import { chain } from 'alien-middleware'

// A common pattern is to declare a dedicated type for the environment variables.
type Env = {
  API_KEY: string
}

const app = chain<any, Env>().use(context => {
  const key = context.env('API_KEY')
  //    ^? string
})
```

When defining a middleware, you can declare env types that the middleware expects to use.

```typescript
import type { RequestContext } from 'alien-middleware'

// Assuming `Env` is defined like in the previous example.
const myMiddleware = (context: RequestContext<any, Env>) => {
  const key = context.env('API_KEY')
}
```

In both examples, we skip declaring any additional context properties (the first type parameter) because we're not using any. The second type parameter is for environment variables. The third is for the special `context.platform` property, whose value is provided by the host platform (e.g. Node.js, Deno, Bun, etc). On principle, a middleware should avoid using the `context.platform` property, since that could make it non-portable unless you write extra fallback logic for other hosts.

## Router

The `routes` function provides a way to create a router instance for handling different paths and HTTP methods.

```typescript
import { routes } from 'alien-middleware/router'

const router = routes()
```

### Path Parameter Type Inference

The `routes` function leverages `pathic` to provide type inference for path parameters.

```typescript
import { routes } from 'alien-middleware/router'

const router = routes()

router.use('/users/:userId', context => {
  // context.params.userId is automatically typed as string
  const userId = context.params.userId
  return new Response(`User ID: ${userId}`)
})
```

### Handling Specific HTTP Methods

You can specify one or more HTTP methods for a route by providing the method(s) as the first argument to `.use()`.

```typescript
import { routes } from 'alien-middleware/router'

const router = routes()

// This handler will only run for GET requests to /api/items
router.use('GET', '/api/items', context => {
  return new Response('List of items')
})

// This handler will only run for POST requests to /api/items
router.use('POST', '/api/items', context => {
  return new Response('Create a new item', { status: 201 })
})

// This handler will run for both PUT and PATCH requests to /api/items/:id
router.use(['PUT', 'PATCH'], '/api/items/:id', context => {
  const itemId = context.params.id
  return new Response(`Update item ${itemId}`)
})

// This handler will run for any method to /status
router.use('/status', context => {
  return new Response('Status: OK')
})
```

> [!NOTE]
> Your routes don't need to be in any particular order, unless their path
> patterns are exactly the same. The `pathic` library will match the most
> specific path first. This allows you to split your routes into multiple files
> for better organization.

### Type-Safe Middleware with `routes()`

You can pass a middleware chain to the `routes()` function to apply middleware specifically to the routes defined by that router instance. This provides type safety for context extensions within the router.

```typescript
import {
  chain,
  type RequestContext,
  type RequestPlugin,
} from 'alien-middleware'
import { routes } from 'alien-middleware/router'

// Define a middleware that adds a user to the context
const addUserMiddleware = (context: RequestContext): RequestPlugin => {
  const user = { id: 123, name: 'Alice' }
  return { define: { user } }
}

// Create a chain with the middleware
const authMiddlewares = chain(addUserMiddleware)

// Pass the chain to the routes function
const authenticatedRouter = routes(authMiddlewares)

// Define a route that uses the context property added by the middleware
authenticatedRouter.use('/profile', context => {
  // context.user is now type-safe and available
  return new Response(`Welcome, ${context.user.name}!`)
})

// Routes defined on a router without a chain won't have the user property
const publicRouter = routes()

publicRouter.use('/public', context => {
  // context.user is not available here
  // @ts-expect-error - user is not defined on this context
  console.log(context.user)
  return new Response('Public content')
})

// You can combine routers using .use()
const app = chain().use(authenticatedRouter).use(publicRouter)
```
