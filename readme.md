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
const appWithInitial = chain(ctx => {
  console.log('Initial middleware running for:', ctx.request.url)
})
```

### Adding Middleware with `.use()`

Use the `.use()` method to add middleware functions to the chain. Each call to `.use()` returns a _new_, immutable chain instance.

```typescript
import type { RequestContext } from 'alien-middleware'

const firstMiddleware = (ctx: RequestContext) => {
  console.log('First middleware')
  // Doesn't return anything, so the chain continues
}

const secondMiddleware = (ctx: RequestContext) => {
  console.log('Second middleware')
  return new Response('Hello from middleware!', { status: 200 })
  // Returns a Response, terminating the request-phase chain
}

// Add middleware sequentially
const finalApp = app.use(firstMiddleware).use(secondMiddleware)
```

> [!NOTE]
> Middleware chains are immutable. Each call to `.use()` returns a new chain instance.

### Executing the Chain

To run the middleware chain, call the chain instance itself with a context object. This object typically comes from an adapter like Hattip's [Node adapter](https://www.npmjs.com/package/@hattip/adapter-node).

```typescript
// Simplified context for demonstration (requires necessary imports like 'noop' if run directly)
const context: AdapterRequestContext = {
  request: new Request('http://localhost/test'),
  ip: '127.0.0.1',
  platform: {},
  waitUntil: (promise: Promise<any>) => {},
  passThrough: () => {},
  env: (key: string) => undefined, // Basic env function
}

// Execute the chain
const response = await finalApp(context) // Assuming finalApp from previous example

console.log(await response.text()) // Output: Hello from middleware!
console.log(response.status) // Output: 200
```

> [!NOTE]
> If no middleware in the chain returns a `Response`, a `404 Not Found` response
> is automatically returned, except for nested chains.

### Request Middleware

Request middleware runs sequentially before a `Response` is generated.

- **Terminating the Chain:** Return a `Response` object to stop processing subsequent request middleware.

  ```typescript
  const earlyResponder = (ctx: RequestContext) => {
    if (ctx.request.url.endsWith('/forbidden')) {
      return new Response('Forbidden', { status: 403 })
    }
    // Otherwise, continue the chain
  }
  ```

- **Extending Context:** Return an object with a `define` property to add properties to the context for _downstream_ middleware.

  ```typescript
  const addUser = (ctx: RequestContext) => {
    // In a real app, you might look up a user based on a token
    const user = { id: 1, name: 'Alice' }

    return { define: { user } }
  }

  const greetUser = (
    ctx: RequestContext<{ user: { id: number; name: string } }>
  ) => {
    // The `user` property is now available thanks to `addUser`
    return new Response(`Hello, ${ctx.user.name}!`)
  }

  const userApp = app.use(addUser).use(greetUser)
  ```

  > [!NOTE]
  > If you're wondering why you need to return a `{ define: { … } }` object
  > (rather than using simple assignment), it's because TypeScript is unable to
  > infer the type of the context object downstream if you don't do this.
  >
  > Another thing to note is you don't typically define middlewares outside the
  > `.use(…)` call expression, since that requires you to unnecessarily declare
  > the type of the context object. It's better to define them inline.

- **Extending Environment:** Return an object with an `env` property to add environment variables accessible via `ctx.env()`.

  ```typescript
  const addApiKey = (ctx: RequestContext) => {
    return { env: { API_KEY: 'secret123' } }
  }

  const useApiKey = (ctx: RequestContext<{}, { API_KEY: string }>) => {
    const key = ctx.env('API_KEY')
    console.log('API Key:', key) // Output: API Key: secret123
  }

  const envApp = app.use(addApiKey).use(useApiKey)
  ```

### Response Middleware

Response middleware runs _after_ a `Response` has been generated by a request middleware or the final handler. It receives both the context and the generated `Response`.

```typescript
const addHeader = (ctx: RequestContext, response: Response) => {
  response.headers.set('X-Powered-By', 'alien-middleware')
}

const mainHandler = (ctx: RequestContext) => {
  return new Response('Main content')
}

// `addHeader` runs after `mainHandler` generates a response
const headerApp = app.use(mainHandler).use(addHeader)

// Assuming `context` is defined as in the "Executing the Chain" example
const responseWithHeader = await headerApp(context)
console.log(responseWithHeader.headers.get('X-Powered-By')) // Output: alien-middleware
```

> [!NOTE]
> Response middleware cannot extend the context using `{ define }` or `{ env }`.
> They can only inspect the `Response` or replace it by returning a new
> `Response`.

### Nesting Chains

You can compose middleware by nesting chains using `.use()`. Context modifications (`define`, `env`) within a nested chain are scoped to that chain and do not affect middleware outside of it.

```typescript
const innerChain = chain((ctx: RequestContext) => {
  console.log('Inner chain start')
  return { define: { innerData: 'secret' } } // Only available inside innerChain
}).use((ctx: RequestContext<{ innerData: string }>) => {
  console.log('Accessing inner data:', ctx.innerData)
})

const outerMiddleware = (ctx: RequestContext) => {
  // ctx.innerData is not accessible here
  console.log('Outer middleware after inner chain')
  if (!('innerData' in ctx)) {
    console.log('innerData is correctly scoped.')
  }
  return new Response('Finished')
}

const nestedApp = app.use(innerChain).use(outerMiddleware)

// Assuming `context` is defined as in the "Executing the Chain" example
await nestedApp(context)
// Output:
// Inner chain start
// Accessing inner data: secret
// Outer middleware after inner chain
// innerData is correctly scoped.
```

If a nested chain does not return a `Response`, execution continues with the next middleware in the outer chain.
