const DEBUG = true;

self.addEventListener("activate", async function (event) {
  console.log("SW activated");
  sendMessageToParent({ type: "reload" }, false);
});

self.addEventListener("install", async function (event) {
  console.log("SW installed");
});

self.addEventListener("fetch", function (event) {
  event.respondWith(fetchInterceptor(event));
});

function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0,
      v = c == "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function fetchInterceptor(event) {
  const clientId = event.resultingClientId || event.clientId;

  if (DEBUG) {
    console.log(
      "[fetch:sw:0] url",
      event.request.url,
      "resultingClientId",
      event.resultingClientId,
      "clientId",
      event.clientId
    );
  }

  return Promise.race([
    event.request.destination === "iframe"
      ? Promise.resolve(false)
      : self.clients.get(clientId).then((client) => {
          const isIframeEvent =
            (client && client.frameType === "nested") ||
            event.request.destination === "iframe";

          return (
            !isIframeEvent ||
            /\/__smart_app__/.test(event.request.url) ||
            !event.request.url.startsWith("http://localhost:8080")
          );
        }),
    new Promise((resolve) => setTimeout(() => resolve(1), 100)),
  ]).then((needToLoadImmediately) => {
    if (DEBUG) {
      console.log(
        "[fetch:sw]",
        event.request.url,
        clientId,
        needToLoadImmediately,
        needToLoadImmediately ? "WEB" : "IFRAME"
      );
    }

    if (needToLoadImmediately) return fetch(event.request);

    return loadDataThroughParent(event.request);
  });
}

function loadDataThroughParent(request) {
  const headers = Array.from(request.headers.entries()).reduce(
    (headers, [key, value]) => ({ ...headers, [key]: value }),
    {}
  );

  return request
    .arrayBuffer()
    .then((body) =>
      sendMessageToParent({
        type: "request",
        url: request.url,
        method: request.method,
        headers,
        body: request.method === "GET" ? null : body,
      })
    )
    .then((response) => {
      const responseInit = {
        status: response.status,
        statusText: "smartAppIntercepted",
        headers: response.headers,
      };

      return new Response(response.body, responseInit);
    });
}

function sendMessageToParent(message, waitResponse = true) {
  const messageId = uuidv4();

  return self.clients
    .matchAll({
      includeUncontrolled: true,
      type: "all",
    })
    .then((clients) => {
      const client = clients && clients.length && clients[0];

      if (!client) return Promise.reject("Client not found for postMessage");

      if (DEBUG) console.log("[send::sw]", message, client);

      client.postMessage({ ...message, messageId });
    })
    .then(() => {
      if (!waitResponse) return null;

      return new Promise((resolve) => {
        const handleMessage = (event) => {
          if (DEBUG) console.log("[recv::sw]", event.data);

          if (event.data.messageId === messageId) {
            self.removeEventListener("message", handleMessage);
            resolve(event.data);
          }
        };

        self.addEventListener("message", handleMessage);
      });
    });
}
