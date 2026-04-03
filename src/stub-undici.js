// Stub for undici — only ProxyAgent is imported by @actions/http-client, and
// it is only instantiated when an HTTP proxy is in use (via core.getIDToken(),
// which this action never calls). Keeping undici out of the bundle saves ~380 KB.
export class ProxyAgent {}
