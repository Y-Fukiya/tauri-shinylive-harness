#!/usr/bin/env node
import path from "node:path";

import { distRoot, removeTree, rootDir, toPosix } from "./harness-core.mjs";

await removeTree(distRoot);

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
