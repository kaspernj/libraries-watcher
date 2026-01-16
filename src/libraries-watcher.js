import fs from "fs/promises"
import ignoreFile from "./ignore-file.js"
import path from "path"
import pathExists from "./path-exists.js"
import retry from "awaitery/build/retry.js"
import WatchedLibrary from "./watched-library.js"

export default class LibrariesWatcher {
  /**
   * @param {object} args
   * @param {import("./types.js").LibraryObject[]} args.libraries
   * @param {boolean} [args.verbose]
   * @param {string[]} [args.immediateEvents]
   */
  constructor({libraries, verbose = false, immediateEvents = ["addDir"], ...restProps}) {
    const restPropsKeys = Object.keys(restProps)

    if (restPropsKeys.length > 0) throw new Error(`Unknown properties: ${restPropsKeys}`)
    if (!libraries || !Array.isArray(libraries)) throw new Error(`libraries must be an array`)

    /** @type {import("./types.js").CallbackFunctionArgs[]} */
    this.events = []
    this.immediateEventsQueue = []
    this.handlingEvents = false
    this.libraries = libraries
    this.verbose = verbose
    this.immediateEvents = new Set(immediateEvents)

    /** @type {Array<WatchedLibrary>} */
    this.watchedLibraries = []
  }

  /** @returns {Promise<void>} */
  async watch() {
    for (const library of this.libraries) {
      const watchedLibrary = new WatchedLibrary({
        library,
        librariesWatcher: this,
        verbose: this.verbose
      })

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

  /**
   * @param {import("./types.js").CallbackFunctionArgs} event
   * @returns {Promise<void>}
   */
  callback = async (event) => {
    this.enqueueEvent(event)
  }

  async handleEvents() {
    try {
      if (this.handlingEvents) return
      this.handlingEvents = true

      while (this.immediateEventsQueue.length > 0 || this.events.length > 0) {
        const event = this.immediateEventsQueue.shift() ?? this.events.shift()

        if (event) {
          await this.handleEvent(event)
        }
      }
    } finally {
      this.handlingEvents = false
      if (this.immediateEventsQueue.length > 0 || this.events.length > 0) this.handleEvents()
    }
  }

  /**
   * @param {import("./types.js").CallbackFunctionArgs} event
   * @returns {void}
   */
  enqueueEvent(event) {
    if (this.immediateEvents.has(event.event)) {
      this.immediateEventsQueue.push(event)
    } else {
      this.events.push(event)
    }

    this.handleEvents()
  }

  /**
   * @param {import("./types.js").CallbackFunctionArgs} event
   * @returns {Promise<void>}
   */
  async handleEvent({event, isDirectory, localPath, sourcePath, stats, watchedLibrary}) {
    if (ignoreFile(sourcePath)) {
      if (this.verbose) console.log(`Ignoring ${event} on ${sourcePath}`)
      return
    }

    if (!watchedLibrary) throw new Error("'watchedLibrary' not given")

    for (const destination of watchedLibrary.library.destinations) {
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
          let link

          try {
            link = await fs.readlink(sourcePath)
          } catch (error) {
            if (error instanceof Error && error.message.startsWith("ENOENT: ")) {
              console.error(`Couldn't copy ${sourcePath} to ${targetPath} - symlink has been deleted: ${error.message}`)
              return
            } else {
              throw error
            }
          }

          if (this.verbose) console.log(`Making symlink here ${targetPath} with link: ${link}`)

          if (await pathExists(targetPath)) {
            let targetStats

            try {
              targetStats = await fs.lstat(targetPath)
            } catch (error) {
              if (error instanceof Error && error.message.startsWith("ENOENT: ")) {
                targetStats = null
              } else {
                throw error
              }
            }

            if (!targetStats) {
              await fs.symlink(link, targetPath)
              return
            }

            if (targetStats.isSymbolicLink()) {
              const existingLink = await fs.readlink(targetPath)

              if (existingLink === link) {
                return
              }
            }

            if (targetStats.isDirectory()) {
              await fs.rm(targetPath, {recursive: true})
            } else {
              await fs.unlink(targetPath)
            }
          }

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
            await fs.mkdir(targetPath, {mode: lstat.mode, recursive: true})
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

        await this.syncDirectoryContents({localPath, sourcePath, watchedLibrary})
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

  /**
   * @param {object} args
   * @param {string} args.sourcePath
   * @param {string} args.localPath
   * @param {import("./watched-library.js").default} args.watchedLibrary
   * @returns {Promise<void>}
   */
  async syncDirectoryContents({sourcePath, localPath, watchedLibrary}) {
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
      const fileName = dirEntry.name
      const fullPath = path.join(sourcePath, fileName)

      if (ignoreFile(fullPath)) continue

      const childLocalPath = path.join(localPath, fileName)
      let stats

      try {
        stats = await fs.lstat(fullPath)
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("ENOENT: ")) {
          continue
        }

        throw error
      }

      await this.handleEvent({
        event: stats.isDirectory() ? "addDir" : "add",
        isDirectory: stats.isDirectory(),
        localPath: childLocalPath,
        sourcePath: fullPath,
        stats,
        watchedLibrary
      })
    }
  }
}
