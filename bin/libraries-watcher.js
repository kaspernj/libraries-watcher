#!/usr/bin/env node

import fs from "fs/promises"
import LibrariesWatcher from "../src/libraries-watcher.js"

const processArgs = process.argv.slice(2)
const args = {}

for (let i = 0; i < processArgs.length; i++) {
  const arg = processArgs[i]

  if (arg == "--help" || arg == "-h") {
    console.log("Usage: libraries-watcher [options]")
    console.log("Options:")
    console.log("--help, -h: Show this help message")
    console.log("--config, -c: Path to the config file")
    console.log("--verbose, -v: Show more information")

    process.exit()
  } else if (arg == "--config" || arg == "-c") {
    args.config = processArgs[++i]
  } else if (arg == "--verbose" || arg == "-v") {
    args.verbose = true
  } else {
    throw new Error(`Unknown argument ${arg}`)
  }
}

if (!args.config) throw new Error("No config file specified")
if (args.verbose) console.log(`Using config file ${args.config}`)

const configJson = await fs.readFile(args.config)

// @ts-expect-error
const config = JSON.parse(configJson)

const librariesWatcher = new LibrariesWatcher({libraries: config, verbose: args.verbose})

await librariesWatcher.watch()
