import { DurableObject } from "cloudflare:workers";
import {
  startAndWaitForPort,
  proxyFetch,
  loadBalance,
  list,
} from "./containerHelpers";
import htmlTemplate from "./template";

// Set this to the open port on your container
const OPEN_CONTAINER_PORT = 8080;

// If you are load balancing over several instances,
// set this to the number you want to have live
const LB_INSTANCES = 5;

export default {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;

    // If you wish to route requests to a specific container,
    // pass a container identifier to .get()

    if (pathname.startsWith("/specific/")) {
      // In this case, each unique pathname with spawn a new container
      let id = env.MY_CONTAINER.idFromName(pathname);
      let stub = env.MY_CONTAINER.get(id);
      return await stub.fetch(request);
    }

    if (pathname.startsWith("/ls")) {
      const containers = list(env.MY_CONTAINER, LB_INSTANCES);
      const promises = [];
      const texts = [];
      let id = 0;
      for (const container of containers) {
        const containerId = id;
        id++;

        promises.push(
          container
            .fetch("http://foo.com")
            .then((res) => {
              console.log("response", containerId, res.status);
              return res.text();
            })
            .then((res) => {
              console.log("resolved: " + res + " " + containerId);
              texts.push(`${containerId}: ${res}`);
            }),
        );
      }

      await Promise.all(promises);
      return new Response(`Container list:\n${texts.join("\n")}`);
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
  started = false;
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.started = await startAndWaitForPort(
        ctx.id,
        ctx.container,
        OPEN_CONTAINER_PORT,
      );
    });
  }

  async fetch(request) {
    if (!this.started) {
      this.started = await startAndWaitForPort(
        this.ctx.id,
        this.ctx.container,
        OPEN_CONTAINER_PORT,
      );

      if (!this.started) {
        return new Response(
          "we could not provision a container here: " + this.ctx.id.toString(),
          {
            status: 400,
          },
        );
      }
    }

    try {
      return await proxyFetch(this.ctx.container, request, OPEN_CONTAINER_PORT);
    } catch (err) {
      if (err.message && err.message.includes("can be provided")) {
        return new Response(
          "we could not provision a container here (after checking): " +
            this.ctx.id.toString(),
          {
            status: 400,
          },
        );
      }

      throw err;
    }
  }
}
