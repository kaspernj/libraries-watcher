import chokidar from "chokidar"
import fs from "fs/promises"
import wait from "awaitery/build/wait.js"
import nodePath from "path"
import pathExists from "./path-exists.js"

export default class DirectoryListener {
  /**
   * @param {object} args
   * @param {string} args.sourcePath
   * @param {import("./types.js").IgnoreFunction} args.ignore
   * @param {string} args.localPath
   * @param {boolean} args.verbose
   * @param {import("./watched-library.js").default} args.watchedLibrary
   * @param {string} [args.watchFor]
   */
  constructor(args) {
    const {sourcePath, ignore, localPath, verbose, watchedLibrary, watchFor, ...restProps} = args
    const restPropsKeys = Object.keys(restProps)

    if (restPropsKeys.length > 0) throw new Error(`${restPropsKeys} are not supported`)

    this.args = args
    this.librariesWatcher = watchedLibrary.librariesWatcher
    this.active = false
    this.initial = true
    this.localPath = localPath
    this.processInitialEvents = false
    this.sourcePath = sourcePath
    this.shouldKeepWatching = true
    this.restartingPromise = null
    this.tempData = {}
    this.verbose = verbose
    this.watchedLibrary = watchedLibrary
  }

  /**
   * @param {boolean} [processInitialEvents=false]
   * @returns {Promise<void>}
   */
  watch(processInitialEvents = false) {
    this.initial = true
    this.active = false
    this.processInitialEvents = processInitialEvents

    return new Promise((resolve, reject) => {
      this.watchResolve = resolve
      this.watchReject = reject

      this.watcher = chokidar.watch(this.sourcePath, {alwaysStat: true, ignored: this.ignored})
      this.watcher.on("ready", this.onChokidarReady)
      this.watcher.on("error", this.onChokidarError)
      this.watcher.on("all", this.onChokidarEvent)
      this.watcher.on("raw", this.onChokidarRaw)
    })
  }

  /**
   * @param {string} event
   * @param {string} eventPath
   * @param {{watchedPath: string}} details
   * @param {...any} restArgs
   */
  onChokidarRaw = async (event, eventPath, details, ...restArgs) => {
    if (this.verbose) console.log("onChokidarRaw", {event, eventPath, details, restArgs})

    if (event == "rename" && details?.watchedPath) {
      const sourcePath = details.watchedPath.endsWith(eventPath)
        ? details.watchedPath
        : (nodePath.isAbsolute(eventPath)
          ? eventPath
          : nodePath.join(details.watchedPath, eventPath))
      let lstats

      try {
        lstats = await fs.lstat(sourcePath)
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("ENOENT")) {
          console.error(`Can't handle event ${event} for ${sourcePath} - it no longer exists`)
          return
        }
      }

      if (!lstats) {
        console.error("Couldn't get lstats")
        return
      }

      if (!lstats.isSymbolicLink() && lstats.isDirectory() && details.watchedPath.endsWith(eventPath)) {
        const name = sourcePath.substring(this.sourcePath.length + 1, sourcePath.length)
        const localPath = `${this.localPath}/${name}`

        // This happens when chmod'ing a directory
        this.librariesWatcher.callback({
          event: "changeDir",
          isDirectory: lstats.isDirectory(),
          localPath,
          sourcePath,
          stats: lstats,
          watchedLibrary: this.watchedLibrary
        })
      } else {
        const mappedEvent = lstats.isDirectory() ? "addDir" : "add"

        await this.onChokidarEvent(mappedEvent, sourcePath, lstats)
      }
    }
  }

  /** @returns {void} */
  onChokidarReady = () => {
    this.initial = false
    this.active = true

    if (!this.watchResolve) throw new Error("No watchResolve?")

    this.watchResolve()
    this.watchResolve = null
    this.watchReject = null
  }

  /**
   * @param {unknown} error
   * @returns {void}
   */
  onChokidarError = (error) => {
    if (this.watchReject) {
      this.watchReject(error)
    } else {
      console.error(error)
    }
  }

  /**
   * @param {string} fullPath
   * @returns {boolean}
   */
  ignored = (fullPath) => {
    const fileName = fullPath.substring(this.sourcePath.length + 1, fullPath.length)

    if (fileName == "") return false

    const localPath = `${this.localPath}/${fileName}`

    let shouldIgnore = false

    if (this.args.ignore) {
      shouldIgnore = this.args.ignore({fileName, localPath, fullPath})
    }

    return shouldIgnore
  }

  /**
   * @param {boolean} [permanent=false]
   * @returns {Promise<void>}
   */
  async stopListener(permanent = false) {
    if (this.verbose) console.log(`Stop listener for ${this.sourcePath}`)

    if (permanent) {
      this.shouldKeepWatching = false
    }

    if (!this.active) {
      if (this.verbose) console.log(`Listener already stopped for ${this.sourcePath}`)
      return
    }

    if (this.watcher) {
      await this.watcher.close()
    }

    this.active = false
    delete this.watcher
  }

  /**
   * @param {string} path
   * @param {string} fileName
   * @returns {Promise<import("fs").Dirent | undefined>}
   */
  async getDirent(path, fileName) {
    const files = await fs.readdir(path, {withFileTypes: true})
    const found = []

    for (const file of files) {
      found.push(file.name)

      if (file.name == fileName) {
        return file
      }
    }

    throw new Error(`Couldn't find ${fileName} in ${path}: ${found.join(", ")}`)
  }

  /** @returns {Promise<void>} */
  async waitForSourceToReappear() {
    while (!await pathExists(this.sourcePath)) {
      if (!this.shouldKeepWatching) return
      await wait(200)
    }
  }

  /** @returns {Promise<void>} */
  restartWatcherAfterRecreation = async () => {
    if (this.restartingPromise) return this.restartingPromise

    this.restartingPromise = (async () => {
      console.log(`Stop watching ${this.sourcePath} - source directory removed`)

      await this.stopListener()
      await this.waitForSourceToReappear()

      if (!this.shouldKeepWatching) return

      console.log(`Restart watching ${this.sourcePath} - source directory re-created`)
      await this.watch(true)
    })()

    try {
      await this.restartingPromise
    } finally {
      this.restartingPromise = null
    }
  }

  /**
   * @param {import("chokidar/handler.js").EventName} event
   * @param {string} fullPath
   * @param {import("fs").Stats} stats
   * @returns {Promise<void>}
   */
  onChokidarEvent = async (event, fullPath, stats) => {
    if (this.initial && !this.processInitialEvents) return

    const name = fullPath.substring(this.sourcePath.length + 1, fullPath.length)
    const sourcePath = `${this.sourcePath}/${name}`
    const localPath = `${this.localPath}/${name}`

    let isDirectory

    if (event == "add" || event == "unlink") {
      isDirectory = false
    } else if (event == "addDir" || event == "unlinkDir") {
      isDirectory = true
    } else {
      isDirectory = stats.isDirectory()
    }

    if (this.verbose) console.log(`${localPath} ${event}`)

    if (event == "unlinkDir" && fullPath == this.sourcePath) {
      await this.librariesWatcher.callback({
        event,
        isDirectory,
        localPath,
        sourcePath,
        stats,
        watchedLibrary: this.watchedLibrary
      })
      await this.restartWatcherAfterRecreation()
      return
    }

    this.librariesWatcher.callback({
      event,
      isDirectory,
      localPath,
      sourcePath,
      stats,
      watchedLibrary: this.watchedLibrary
    })
  }
}
