import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// Get dirname compatible with esm and esbuild
const _filename = typeof __filename !== "undefined" ? __filename : fileURLToPath(import.meta.url);
const _dirname = typeof __dirname !== "undefined" ? __dirname : path.dirname(_filename);

const frontendPath = path.resolve(_dirname, "../../sbb-connections/dist/public");
if (fs.existsSync(frontendPath)) {
  app.use(express.static(frontendPath));
  app.get("*", (req, res, next) => {
    if (!req.path.startsWith("/api")) {
      res.sendFile(path.resolve(frontendPath, "index.html"));
    } else {
      next();
    }
  });
}

export default app;
