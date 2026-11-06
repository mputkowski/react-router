Add a `TRUST_PROXY` environment variable that sets Express's `trust proxy` setting, so `request.url` uses the protocol and host reported by a trusted reverse proxy

- Fixes same-origin action submissions failing origin validation behind a proxy that terminates TLS
