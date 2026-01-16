import DirectoryListener from "./directory-listener.js"
import fs from "fs/promises"
import nodePath from "path"

export default class WatchedLibrary {
  /**
   * @param {object} args
   * @param {import("./libraries-watcher.js").default} args.librariesWatcher
   * @param {import("./types.js").LibraryObject} args.library
   * @param {boolean} [args.verbose]
   */
  constructor({librariesWatcher, library, verbose = false, ...restProps}) {
    const restPropsKeys = Object.keys(restProps)

    if (restPropsKeys.length) {
      throw new Error(`Unknown props: ${restPropsKeys}`)
    }

    this.library = library
    this.librariesWatcher = librariesWatcher
    this.rootPath = library.source
    this.verbose = verbose

    /** @type {Map<string, DirectoryListener>} */
    this.directoryListeners = new Map()
  }

  /** @returns {Promise<void>} */
  async watch() {
    await this.watchDirectoryTree({
      localPath: "",
      processInitialEvents: false,
      restartOnRemove: true,
      sourcePath: this.rootPath
    })
  }

  /** @returns {Promise<void>} */
  async stopWatch() {
    const listeners = Array.from(this.directoryListeners.values())

    for (const listener of listeners) {
      await listener.stopListener(true)
    }

    this.directoryListeners.clear()
  }

  /**
   * @param {object} args
   * @param {string} args.sourcePath
   * @param {string} args.localPath
   * @param {boolean} [args.processInitialEvents]
   * @param {boolean} [args.restartOnRemove]
   * @returns {Promise<void>}
   */
  watchDirectoryTree = async ({sourcePath, localPath, processInitialEvents = false, restartOnRemove = false}) => {
    if (this.directoryListeners.has(sourcePath)) {
      await this.watchSubDirectories({sourcePath, localPath, processInitialEvents})
      return
    }

    const listener = new DirectoryListener({
      localPath,
      ignore: this.shouldIgnore,
      restartOnRemove,
      sourcePath,
      verbose: this.verbose,
      watchedLibrary: this
    })

    this.directoryListeners.set(sourcePath, listener)
    await listener.watch(processInitialEvents)
    await this.watchSubDirectories({sourcePath, localPath, processInitialEvents})
  }

  /**
   * @param {object} args
   * @param {string} args.sourcePath
   * @param {string} args.localPath
   * @param {boolean} args.processInitialEvents
   * @returns {Promise<void>}
   */
  watchSubDirectories = async ({sourcePath, localPath, processInitialEvents}) => {
    let dirEntries

    try {
      dirEntries = await fs.readdir(sourcePath, {withFileTypes: true})
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("ENOENT: ")) {
        return
      }

      throw error
    }

    for (const dirEntry of dirEntries) {
      if (!dirEntry.isDirectory()) continue

      const fileName = dirEntry.name
      const fullPath = nodePath.join(sourcePath, fileName)
      const childLocalPath = nodePath.join(localPath, fileName)

      if (this.shouldIgnore({fileName, localPath: childLocalPath, fullPath})) continue

      await this.watchDirectoryTree({
        localPath: childLocalPath,
        processInitialEvents,
        restartOnRemove: false,
        sourcePath: fullPath
      })
    }
  }

  /**
   * @param {string} sourcePath
   * @returns {Promise<void>}
   */
  stopWatchingDirectoryTree = async (sourcePath) => {
    if (sourcePath == this.rootPath) return

    const watchedPaths = Array.from(this.directoryListeners.keys())

    for (const watchedPath of watchedPaths) {
      if (!this.isWithinPath(sourcePath, watchedPath)) continue

      const listener = this.directoryListeners.get(watchedPath)

      if (listener) {
        await listener.stopListener(true)
        this.directoryListeners.delete(watchedPath)
      }
    }
  }

  /**
   * @param {string} basePath
   * @param {string} candidatePath
   * @returns {boolean}
   */
  isWithinPath = (basePath, candidatePath) => {
    const relative = nodePath.relative(basePath, candidatePath)

    return relative == "" || (!relative.startsWith("..") && !nodePath.isAbsolute(relative))
  }

  /**
   * @param {import("./types.js").IgnoreFunctionArgs} args
   * @returns {boolean}
   */
  shouldIgnore = ({fileName}) => {
    if (fileName.startsWith(".") || fileName == "node_modules") {
      return true
    }

    return false
  }
}
