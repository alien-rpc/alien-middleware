const urlDescriptor: PropertyDescriptor = {
  configurable: true,
  get(this: { request: Request }) {
    const url = new URL(this.request.url)
    Object.defineProperty(this, 'url', { value: url })
    return url
  },
}

export function defineParsedURL(context: { request: Request; url: URL }) {
  if (!('url' in context)) {
    Object.defineProperty(context, 'url', urlDescriptor)
  }
}
