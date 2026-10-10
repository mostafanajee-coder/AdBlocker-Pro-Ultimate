"use strict";
const http = require("node:http"), fs = require("node:fs"), path = require("node:path");
const root = path.resolve(__dirname, "..");
const files = new Map([
  ["/", [path.join(__dirname, "engine-browser-fixture.html"), "text/html"]],
  ...["advanced-rules.js", "procedural-engine.js", "scriptlet-engine.js", "content.js"].map(name => ["/" + name, [path.join(root, name), "text/javascript"]]),
  ...["fixture-setup.js", "fixture-tests.js"].map(name => ["/" + name, [path.join(__dirname, name), "text/javascript"]])
]);
const server = http.createServer((request, response) => {
  const file = files.get(new URL(request.url, "http://127.0.0.1/").pathname);
  if (!file) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { "Content-Type": file[1] + "; charset=utf-8", "Cache-Control": "no-store" });
  fs.createReadStream(file[0]).pipe(response);
});
server.listen(0, "127.0.0.1", () => console.log("Fixture: http://127.0.0.1:" + server.address().port + "/"));
