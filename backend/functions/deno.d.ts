declare namespace Deno {
  interface Env {
    get(key: string): string | undefined;
  }

  const env: Env;

  interface ServeOptions {
    port?: number;
    hostname?: string;
    onListen?: (params: { hostname: string; port: number }) => void;
  }

  function serve(
    handler: (req: Request) => Response | Promise<Response>,
    options?: ServeOptions
  ): void;
}
