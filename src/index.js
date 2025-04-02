import { DurableObject } from "cloudflare:workers";
import {
  startAndWaitForPort,
  proxyFetch,
  loadBalance,
} from "./containerHelpers";
import htmlTemplate from "./template";

// Set this to the open port on your container
const OPEN_CONTAINER_PORT = 8080;

// If you are load balancing over several instances,
// set this to the number you want to have live
const LB_INSTANCES = 3;

export default {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;

    // If you wish to route requests to a specific container,
    // pass a container identifier to .get()

    if (pathname.startsWith("/specific/")) {
      // In this case, each unique pathname will spawn a new container
      let id = env.MY_CONTAINER.idFromName(pathname);
      let stub = env.MY_CONTAINER.get(id);
      try {
        return await stub.fetch(request);
      } catch (err) {
        return new Response(`Error returned: ${err.message}`);
      }
    }

    // If you wish to route to one of several containers interchangeably,
    // use one of N random IDs

    if (pathname.startsWith("/lb")) {
      let container = await loadBalance(env.MY_CONTAINER, LB_INSTANCES);
      return await container.fetch(request);
    }

    // Serve the homepage if not routing to a container
    return new Response(htmlTemplate, {
      headers: { "Content-Type": "text/html;charset=UTF-8" },
    });
  },
};

export class MyContainer extends DurableObject {
  async log(msg, ...any) {
    console.log(msg, ...any);
    const index = (await this.ctx.storage.get("index")) ?? 0;
    await this.ctx.storage.put(index, `${msg}: ${JSON.stringify(any)}`);
    await this.ctx.storage.put("index", index + 1);
    await this.ctx.storage.sync();
  }

  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      await this.ctx.storage.deleteAll();
      await this.log("CONSTRUCTOR", Date.now());
      ctx.container.start();
      this.monitor = ctx.container.monitor().then(() => {
        this.log("MONITOR EXITED", Date.now());
      });

      let lastErr;
      for (let i = 0; i < 10; i++) {
        try {
          await this.ctx.container
            .getTcpPort(OPEN_CONTAINER_PORT)
            .fetch(new Request("http://foo"));
          await this.log("CONSTRUCTOR", Date.now());
          return;
        } catch (err) {
          lastErr = err;
          if (
            err.message.includes("provided") ||
            err.message.includes("listening")
          ) {
            await new Promise((res) => setTimeout(res, 1000));
            if (err.message.includes("provided")) {
              ctx.container.start();
              this.monitor = ctx.container.monitor().then(() => {
                this.log("MONITOR EXITED", Date.now());
              });
            }

            continue;
          }

          await this.log("CONSTRUCTOR ERR", Date.now(), err.message);
          throw err;
        }
      }

      // Make sure we try again in 1s
      await this.ctx.storage.setAlarm(Date.now() + 1000);

      await this.log("CONSTRUCTOR EXITED WITH ERROR", Date.now());
      throw lastErr;
    });
  }

  async alarm() {}

  async fetch() {
    try {
      const res = await this.ctx.container
        .getTcpPort(OPEN_CONTAINER_PORT)
        .fetch(new Request("http://foo"));
      return new Response(
        `${await res.text()}\nLogs: ${JSON.stringify(Array.from((await this.ctx.storage.list()).values()))}`,
      );
    } catch (err) {
      return new Response(
        `FETCH FAILED\nLogs: ${JSON.stringify(Array.from((await this.ctx.storage.list()).values()))}`,
      );
    }
  }
}
