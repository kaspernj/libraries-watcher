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

    exit()
  } else if (arg == "--config" || arg == "-c") {
    const configPath = processArgs[++i]

    console.log(`Using config file ${configPath}`)

    args.config = configPath
  } else {
    throw new Error(`Unknown argument ${arg}`)
  }
}

if (!args.config) throw new Error("No config file specified")

const configJson = await fs.readFile(args.config)
const config = JSON.parse(configJson)

new LibrariesWatcher({libraries: config})
