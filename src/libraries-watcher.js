import fs from "fs/promises"
import InotifyImport from "inotify-remastered-plus"
import path from "path"

const {Inotify} = InotifyImport

const pathExists = async (fileOrDirPath) => {
  try {
    await fs.access(fileOrDirPath)

    return true
  } catch (error) {
    return false
  }
}

class DirectoryListener {
  constructor(args) {
    const {callback, sourcePath, ignore, inotify, localPath, verbose, watchFor, ...restProps} = args
    const restPropsKeys = Object.keys(restProps)

    if (restPropsKeys.length > 0) {
      throw new Error(`${restPropsKeys} are not supported`)
    }

    this.args = args
    this.localPath = localPath
    this.sourcePath = sourcePath
    this.subDirsListeners = {}
    this.tempData = {}
    this.verbose = verbose
    this.watch = inotify.addWatch({
      path: sourcePath,
      watch_for: watchFor || Inotify.IN_ALL_EVENTS,
      callback: this.callback
    })
  }

  async watchSubDirs() {
    if (this.verbose) console.log(`Watching ${this.sourcePath}`)

    const files = await fs.readdir(this.sourcePath, {withFileTypes: true})

    for (const file of files) {
      const fullPath = `${this.sourcePath}/${file.name}`
      let localPath

      if (this.localPath == "") {
        localPath = file.name
      } else {
        localPath = `${this.localPath}/${file.name}`
      }

      if (file.isDirectory()) {
        let shouldIgnore = false

        if (this.args.ignore) {
          shouldIgnore = this.args.ignore({file, localPath, fullPath})
        }

        if (!shouldIgnore) {
          const directoryListenerArgs = {...this.args}

          directoryListenerArgs.localPath = localPath
          directoryListenerArgs.sourcePath = `${this.sourcePath}/${file.name}`

          const directoryListener = new DirectoryListener(directoryListenerArgs)

          await directoryListener.watchSubDirs()

          this.subDirsListeners[fullPath] = directoryListener
        }
      }
    }
  }

  callback = (event) => {
    const {mask, name} = event
    const sourcePath = `${this.sourcePath}/${name}`
    const localPath = `${this.localPath}/${event.name}`

    if (mask & Inotify.IN_MODIFY) {
      console.log(`${localPath} modified`)

      this.args.callback({
        directoryListener: this,
        event,
        localPath,
        name,
        sourcePath,
        type: "modified"
      })
    } else if (mask & Inotify.IN_CLOSE_WRITE) {
      console.log(`${localPath} closed for writing`)
    } else if (mask & Inotify.IN_CREATE) {
      this.args.callback({
        directoryListener: this,
        event,
        localPath,
        name,
        sourcePath,
        type: "created"
      })
    } else if (mask & Inotify.IN_DELETE) {
      this.args.callback({
        directoryListener: this,
        event,
        localPath,
        name,
        sourcePath,
        type: "deleted"
      })
    } else if (mask & Inotify.IN_MOVED_FROM) {
      this.tempData.cookie = event.cookie
      this.tempData.movedFrom = event.name
    } else if (mask & Inotify.IN_MOVED_TO) {
      if (this.tempData.movedFrom && this.tempData.cookie === event.cookie) {
        this.args.callback({
          directoryListener: this,
          event,
          localPath,
          name,
          pathFrom: this.tempData.movedFrom,
          sourcePath,
          type: "moved"
        })

        delete this.tempData.cookie
        delete this.tempData.movedFrom
      }
    } else {
      this.args.callback({
        directoryListener: this,
        event,
        localPath,
        name,
        sourcePath,
        type: "unknown"
      })
    }
  }
}

class WatchedLibrary {
  constructor({library, inotify, verbose, ...restProps}) {
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
      inotify,
      sourcePath: library.source,
      verbose,
      watchFor: Inotify.IN_MODIFY | Inotify.IN_CREATE | Inotify.IN_DELETE | Inotify.IN_MOVED_FROM | Inotify.IN_MOVED_TO
    })
  }

  async watch() {
    await this.liraryListener.watchSubDirs()
  }

  shouldIgnore = ({file}) => {
    const {name} = file

    if (name.startsWith(".") || name == "node_modules") {
      return true
    }

    return false
  }

  callback = async ({directoryListener, event, localPath, name, sourcePath, type}) => {
    for (const destination of this.library.destinations) {
      const targetPath = `${destination}/${localPath}`

      if (this.verbose) console.log(`${localPath} ${type}`)

      if (type == "created" || type == "modified") {
        if (this.verbose) console.log(`Copy ${sourcePath} to ${targetPath}`)

        const dirName = path.dirname(targetPath)

        if (!await pathExists(dirName)) {
          if (this.verbose) console.log(`Path doesn't exists - create it: ${dirName}`)

          await fs.mkdir(dirName, {recursive: true})
        }

        await await fs.copyFile(sourcePath, targetPath)
      } else if (type == "deleted") {
        if (this.verbose) console.log(`Path ${localPath} was deleted`)

        if (await pathExists(targetPath)) {
          const lstat = await fs.lstat(targetPath)

          if (lstat.isFile() || lstat.isSymbolicLink()) {
            await fs.unlink(targetPath)
          } else if (lstat.isDirectory()) {
            await fs.rm(targetPath, {recursive: true})
          }
        }

        /*
        if (stats.isDirectory()) {
          console.log(`Dir ${localPath} was deleted`)
          // await fs.rm(targetPath, {recursive: true, force: true})
        }
        */
      }
    }
  }
}

class LibrariesWatcher {
  constructor({libraries, verbose, ...restProps}) {
    const restPropsKeys = Object.keys(restProps)

    if (restPropsKeys.length > 0) throw new Error(`Unknown properties: ${restPropsKeys}`)
    if (!libraries || !Array.isArray(libraries)) throw new Error(`libraries must be an array`)

    this.libraries = libraries
    this.verbose = verbose
    this.watchedLibraries = []
    this.inotify = new Inotify()
  }

  async watch() {
    for (const library of this.libraries) {
      const watchedLibrary = new WatchedLibrary({library, inotify: this.inotify, verbose: this.verbose})

      await watchedLibrary.watch()

      this.watchedLibraries.push(watchedLibrary)
    }
  }
}

export default LibrariesWatcher
