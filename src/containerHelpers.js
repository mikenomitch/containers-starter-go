export async function startAndWaitForPort(id, container, portToAwait) {
  try {
    const port = container.getTcpPort(portToAwait);

    for (let i = 0; i < 20; i++) {
      try {
        // It might be the case that we've thrown an error
        // and the container is not running anymore
        if (!container.running) {
          container.start();
        }

        const r = await port.fetch("http://10.0.0.1/");
        await r.text();

        return true;
      } catch (err) {
        console.error(id.toString(), "thrown error:", err);
        if (err.message.includes("listening")) {
          await new Promise((res) => setTimeout(res, 500));
          continue;
        }

        throw err;
      }
    }
  } catch (err) {
    console.warn("Thrown error waiting container:", err.message);
    if (
      err.message.includes(
        "there is no container instance that can be provided",
      )
    ) {
      return false;
    }

    throw err;
  }

  return false;
}

export async function proxyFetch(container, request, portNumber) {
  return await container
    .getTcpPort(portNumber)
    .fetch(request.url.replace("https://", "http://"), request.clone());
}

export async function loadBalance(containerBinding, count) {
  let randomID = Math.floor(Math.random() * count);
  let id = containerBinding.idFromName("lb-" + randomID);
  return containerBinding.get(id);
}

export function list(containerBinding, count) {
  const containers = [];
  for (let i = 0; i < count; i++) {
    let id = containerBinding.idFromName("lb-" + i);
    containers.push(containerBinding.get(id));
  }

  return containers;
}
