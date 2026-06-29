#!/usr/bin/env node
import { rm } from "node:fs/promises";
import path from "node:path";

import { distRoot, rootDir, toPosix } from "./harness-core.mjs";

await rm(distRoot, { recursive: true, force: true });

console.log(
  JSON.stringify(
    {
      ok: true,
      removed: toPosix(path.relative(rootDir, distRoot)),
    },
    null,
    2,
  ),
);
