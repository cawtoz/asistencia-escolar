const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const config = require("./src/config");
const { createDatabase } = require("./src/db");
const { createAuth } = require("./src/auth");
const { createAttendance } = require("./src/attendance");
const { createApi } = require("./src/api");

const publicDir = path.join(__dirname, "public");
const db = createDatabase(config.dataDir);
const auth = createAuth(db, config.dataDir);
const attendance = createAttendance(db, config.timeZone);
const handleAction = createApi(auth, attendance);

function readPublic(relativePath) {
  return fs.readFileSync(path.join(publicDir, relativePath));
}

const teacherView = ["code", "students"].reduce((view, panel) => {
  const marker = `<!-- PANEL_${panel.toUpperCase()} -->`;
  return view.replace(
    marker,
    readPublic(`views/teacher/${panel}.html`).toString(),
  );
}, readPublic("views/teacher.html").toString());

const html = ["login", "student", "teacher"].reduce((page, view) => {
  const marker = `<!-- VIEW_${view.toUpperCase()} -->`;
  const content =
    view === "teacher"
      ? teacherView
      : readPublic(`views/${view}.html`).toString();
  return page.replace(marker, content);
}, readPublic("index.html").toString());

const staticFiles = new Map([["/", [html, "text/html; charset=utf-8"]]]);
for (const [directory, type] of Object.entries({
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  assets: "image/png",
})) {
  for (const file of fs.readdirSync(path.join(publicDir, directory))) {
    const resource = directory + "/" + file;
    staticFiles.set("/" + resource, [readPublic(resource), type]);
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

http
  .createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (req.method === "GET" && staticFiles.has(pathname)) {
      const [content, type] = staticFiles.get(pathname);
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
      return res.end(content);
    }

    if (req.method === "POST" && pathname === "/api") {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) {
        return sendJson(res, 403, { error: "Origen no permitido." });
      }
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
        if (raw.length > 10000) req.destroy();
      });
      req.on("end", () => {
        try {
          sendJson(res, 200, handleAction(req, res, JSON.parse(raw)));
        } catch (error) {
          sendJson(res, error.status || 400, { error: error.message });
        }
      });
      return;
    }

    sendJson(res, 404, { error: "No encontrado." });
  })
  .listen(config.port, "0.0.0.0", () => {
    console.log(`Asistencia escuchando en puerto ${config.port}`);
  });
