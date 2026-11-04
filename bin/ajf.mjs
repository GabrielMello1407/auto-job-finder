#!/usr/bin/env node
// Atalho global: `npm link` uma vez e use `ajf <comando>` em qualquer pasta.
import { register } from "tsx/esm/api";

register();
await import("../src/cli.ts");
