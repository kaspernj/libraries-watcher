// @ts-check

import chokidar from "chokidar"
import fs from "fs/promises"
import path from "path"
import retry from "awaitery/build/retry.js"

/**
 * @typedef {object} CallbackFunctionArgs
 * @property {import("chokidar/handler.js").EventName & "changeDir"} event
 * @property {boolean} isDirectory
 * @property {string} localPath
 * @property {string} sourcePath
 * @property {import("fs").Stats} stats
 */
/**
 * @typedef {function(CallbackFunctionArgs) : void} CallbackFunction
 */

/**
 * @typedef {object} IgnoreFunctionArgs
 * @property {string} fileName
 * @property {string} localPath
 * @property {string} fullPath\
 */
/**
 * @typedef {function(IgnoreFunctionArgs) : boolean} IgnoreFunction
 */

/**
 * @typedef {object} LibraryObject
 * @property {string[]} destinations
 * @property {string} name
 * @property {string} source
 */

/**
 * @param {string} sourcePath
 * @returns {boolean}
 */
function ignoreFile(sourcePath) {
  const extName = path.extname(sourcePath)

  if (extName == ".sqlite-journal") {
    return true
  }

  return false
}

/**
 * @param {string} fileOrDirPath
 * @returns {Promise<boolean>}
 */
async function pathExists(fileOrDirPath) {
  try {
    await fs.access(fileOrDirPath)

    return true
  } catch (error) {
    return false
  }
}

class DirectoryListener {
  /**
   * @param {object} args
   * @param {CallbackFunction} args.callback
   * @param {string} args.sourcePath
   * @param {IgnoreFunction} args.ignore
   * @param {string} args.localPath
   * @param {boolean} args.verbose
   * @param {string} [args.watchFor]
   */
  constructor(args) {
    const {callback, sourcePath, ignore, localPath, verbose, watchFor, ...restProps} = args
    const restPropsKeys = Object.keys(restProps)

    if (restPropsKeys.length > 0) throw new Error(`${restPropsKeys} are not supported`)

    this.args = args
    this.initial = true
    this.localPath = localPath
    this.sourcePath = sourcePath
    this.tempData = {}
    this.verbose = verbose
  }

  /** @returns {Promise<void>} */
  watch() {
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
   * @param {string} path
   * @param {{watchedPath: string}} details
   * @param {...any} restArgs
   */
  onChokidarRaw = async (event, path, details, ...restArgs) => {
    if (this.verbose) console.log("onChokidarRaw", {event, path, details, restArgs})

    if (event == "rename" && details.watchedPath.endsWith(path)) {
      const sourcePath = details.watchedPath
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

      if (!lstats.isSymbolicLink() && lstats.isDirectory()) {
        const name = sourcePath.substring(this.sourcePath.length + 1, sourcePath.length)
        const localPath = `${this.localPath}/${name}`

        // This happens when chmod'ing a directory
        // @ts-expect-error
        this.args.callback({event: "changeDir", isDirectory: lstats.isDirectory(), localPath, sourcePath, stats: lstats})
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

  /** @returns {Promise<void>} */
  async stopListener() {
    if (this.verbose) console.log(`Stop listener for ${this.sourcePath}`)
    if (!this.active) throw new Error(`Listener wasn't active for ${this.sourcePath}`)

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

  /**
   * @param {import("chokidar/handler.js").EventName} event
   * @param {string} fullPath
   * @param {import("fs").Stats} stats
   * @returns {Promise<void>}
   */
  onChokidarEvent = async (event, fullPath, stats) => {
    if (this.initial) return

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

    // @ts-expect-error
    this.args.callback({event, isDirectory, localPath, sourcePath, stats})
  }
}

class WatchedLibrary {
  /**
   * @param {object} args
   * @param {LibraryObject} args.library
   * @param {boolean} [args.verbose]
   */
  constructor({library, verbose = false, ...restProps}) {
    const restPropsKeys = Object.keys(restProps)

    if (restPropsKeys.length) {
      throw new Error(`Unknown props: ${restPropsKeys}`)
    }

    this.library = library
    this.verbose = verbose

    this.liraryListener = new DirectoryListener({
      callback: this.callback,
      localPath: "",
      ignore: this.shouldIgnore,
      sourcePath: library.source,
      verbose
    })
  }

  /** @returns {Promise<void>} */
  async watch() {
    await this.liraryListener.watch()
  }

  /** @returns {Promise<void>} */
  async stopWatch() {
    await this.liraryListener.stopListener()
  }

  /**
   * @param {object} args
   * @param {string} args.fileName
   * @returns {boolean}
   */
  shouldIgnore = ({fileName}) => {
    if (fileName.startsWith(".") || fileName == "node_modules") {
      return true
    }

    return false
  }

  /**
   * @param {CallbackFunctionArgs} args
   * @returns {Promise<void>}
   */
  callback = async ({event, isDirectory, localPath, sourcePath, stats}) => {
    if (ignoreFile(sourcePath)) {
      if (this.verbose) console.log(`Ignoring ${event} on ${sourcePath}`)
      return
    }

    for (const destination of this.library.destinations) {
      const targetPath = `${destination}/${localPath}`

      if (event == "add") {
        const dirName = path.dirname(targetPath)

        if (!await pathExists(dirName)) {
          if (this.verbose) console.log(`Path doesn't exists - create it: ${dirName}`)
          await fs.mkdir(dirName, {recursive: true})
        }

        let lstats

        try {
          lstats = await fs.lstat(sourcePath)
        } catch (error) {
          if (error instanceof Error && error.message.startsWith("ENOENT: ")) {
            console.error(`Couldn't copy ${sourcePath} to ${targetPath} - file has been deleted: ${error.message}`)
            return
          } else {
            throw error
          }
        }

        if (lstats.isSymbolicLink()) {
          const link = await fs.readlink(sourcePath)

          if (this.verbose) console.log(`Making symlink here ${targetPath} with link: ${link}`)

          await fs.symlink(link, targetPath)
        } else {
          if (this.verbose) console.log(`Copy ${sourcePath} to ${targetPath}`)

          try {
            await fs.copyFile(sourcePath, targetPath, fs.constants.COPYFILE_FICLONE)
          } catch (error) {
            if (error instanceof Error && error.message.startsWith("ENOENT: ")) {
              console.error(`Couldn't copy ${sourcePath} to ${targetPath} - file has been deleted: ${error.message}`)
            } else {
              throw error
            }
          }
        }
      } else if (event == "addDir") {
        if (this.verbose) console.log(`Create dir ${targetPath}`)

        const dirName = path.dirname(targetPath)

        if (!await pathExists(dirName)) {
          if (this.verbose) console.log(`Path doesn't exists - create it: ${dirName}`)
          await fs.mkdir(dirName, {recursive: true})
        }

        if (!await pathExists(targetPath)) {
          let lstat

          try{
            lstat = await fs.lstat(sourcePath)
          } catch (error) {
            if (error instanceof Error && error.message.includes("ENOENT: no such file or directory")) {
              console.error(`Couldn't copy ${sourcePath} to ${targetPath} - source file has been deleted: ${error.message}`)
              return
            } else {
              throw error
            }
          }

          try {
            await fs.mkdir(targetPath, {mode: lstat.mode})
          } catch (error) {
            if (error instanceof Error && error.message.includes("EEXIST: file already exists")) {
              console.error(`Couldn't create directory ${targetPath} - it already exists: ${error.message}`)
            } else {
              throw error
            }
          }

          await fs.chown(targetPath, lstat.uid, lstat.gid)
          await fs.chmod(targetPath, lstat.mode)
        }
      } else if (event == "change") {
        if (this.verbose) console.log(`Copy ${sourcePath} to ${targetPath}`)

        const dirName = path.dirname(targetPath)

        if (!await pathExists(dirName)) {
          if (this.verbose) console.log(`Path doesn't exists - create it: ${dirName}`)

          await fs.mkdir(dirName, {recursive: true})
        }

        if (isDirectory) {
          // FIXME: What was changed? Should we sync something?
        } else if (!isDirectory) {
          // FIXME: We should only copy entire file, if the content was changed. Can we detect if the contents was changed? Maybe only props were changed?
          try {
            await await fs.copyFile(sourcePath, targetPath, fs.constants.COPYFILE_FICLONE)
          } catch (error) {
            console.error(`Couldn't copy file file: ${error instanceof Error ? error.message : error}`)
          }
        }
      } else if (event == "changeDir") {
        // Sometimes it gets removed really fast again, before we can react to the change.
        try {
          await fs.chmod(targetPath, stats.mode)
        } catch (error) {
          if (error instanceof Error && error.message.startsWith("ENOENT: ")) {
            console.error(`Couldn't change file mode - file has been deleted: ${error.message}`)
          } else {
            throw error
          }
        }
      } else if (event == "unlink") {
        if (this.verbose) console.log(`Path ${localPath} was deleted`)

        if (await pathExists(targetPath)) {
          let lstat

          try {
            lstat = await fs.lstat(targetPath)
          } catch (error) {
            if (error instanceof Error && error.message.startsWith("ENOENT: ")) {
              console.error(`Couldn't delete file - file has already been deleted: ${error.message}`)
              return
            } else {
              throw error
            }
          }

          if (lstat.isFile() || lstat.isSymbolicLink()) {
            try {
              await fs.unlink(targetPath)
            } catch (error) {
              if (error instanceof Error && error.message.startsWith("ENOENT: ")) {
                console.error(`Couldn't delete file - file has already been deleted: ${error.message}`)
              } else {
                throw error
              }
            }
          }
        }
      } else if (event == "unlinkDir") {
        if (this.verbose) console.log(`Path ${localPath} was deleted`)

        if (await pathExists(targetPath)) {
          await retry(async () => {
            await fs.rm(targetPath, {recursive: true})
          })
        }
      } else {
        if (this.verbose) console.log(`${localPath} ${event} unknown!`)
      }
    }
  }
}

class LibrariesWatcher {
  /**
   * @param {object} args
   * @param {LibraryObject[]} args.libraries
   * @param {boolean} [args.verbose]
   */
  constructor({libraries, verbose, ...restProps}) {
    const restPropsKeys = Object.keys(restProps)

    if (restPropsKeys.length > 0) throw new Error(`Unknown properties: ${restPropsKeys}`)
    if (!libraries || !Array.isArray(libraries)) throw new Error(`libraries must be an array`)

    this.libraries = libraries
    this.verbose = verbose

    /** @type {Array<WatchedLibrary>} */
    this.watchedLibraries = []
  }

  /** @returns {Promise<void>} */
  async watch() {
    for (const library of this.libraries) {
      const watchedLibrary = new WatchedLibrary({library, verbose: this.verbose})

      await watchedLibrary.watch()

      this.watchedLibraries.push(watchedLibrary)
    }
  }

  /** @returns {Promise<void>} */
  async stopWatch() {
    for (const watchedLibrary of this.watchedLibraries) {
      await watchedLibrary.stopWatch()
    }
  }
}

export {ignoreFile}
export default LibrariesWatcher
