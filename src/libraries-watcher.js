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
    this.inotify = inotify
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
    this.active = true
  }

  stopListener() {
    if (this.verbose) console.log(`Stop listener for ${this.sourcePath}`)
    if (!this.active) throw new Error(`Listener wasn't active for ${this.sourcePath}`)

    if (!this.watch) {
      throw new Error(`No watch for ${this.sourcePath}`)
    }

    this.inotify.removeWatch(this.watch)
    this.active = false

    for (const subDirListenerPath in this.subDirsListeners) {
      const subDirListener = this.subDirsListeners[subDirListenerPath]

      subDirListener.stopListener()
    }
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
        await this.watchDir({file, localPath, fullPath})
      }
    }
  }

  isWatchingFullPath(fullPath) {
    if (fullPath in this.subDirsListeners) {
      return true
    }

    return false
  }

  async watchDir({file, localPath, fullPath}) {
    let shouldIgnore = false

    if (this.args.ignore) {
      shouldIgnore = this.args.ignore({file, localPath, fullPath})
    }

    if (shouldIgnore) {
      if (this.verbose) console.log(`Ignoring ${localPath}`)
    } else {
      if (this.isWatchingFullPath(fullPath)) throw new Error(`Already watching ${fullPath}`)

      const directoryListenerArgs = {...this.args}

      directoryListenerArgs.localPath = localPath
      directoryListenerArgs.sourcePath = `${this.sourcePath}/${file.name}`

      const directoryListener = new DirectoryListener(directoryListenerArgs)

      await directoryListener.watchSubDirs()

      this.subDirsListeners[fullPath] = directoryListener
    }
  }

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

  callback = async (event) => {
    const {mask, name} = event

    if (!name) return // Unknown event

    const sourcePath = `${this.sourcePath}/${name}`
    const localPath = `${this.localPath}/${name}`
    let isDirectory

    if (mask & Inotify.IN_ISDIR) {
      isDirectory = true
    } else {
      isDirectory = false
    }

    if (mask & Inotify.IN_MODIFY) {
      if (this.verbose) console.log(`${localPath} modified`)

      this.args.callback({
        directoryListener: this,
        event,
        localPath,
        name,
        sourcePath,
        type: "modified"
      })
    } else if (mask & Inotify.IN_CLOSE_WRITE) {
      if (this.verbose) console.log(`${localPath} closed for writing`)
    } else if (mask & Inotify.IN_CREATE) {
      if (isDirectory) {
        const file = await this.getDirent(path.dirname(sourcePath), name)

        if (!this.isWatchingFullPath(sourcePath)) {
          this.watchDir({file, localPath, fullPath: sourcePath})
        }
      }

      this.args.callback({
        directoryListener: this,
        event,
        localPath,
        name,
        sourcePath,
        type: "created"
      })
    } else if (mask & Inotify.IN_DELETE) {
      if (isDirectory) {
        const directoryListener = this.subDirsListeners[sourcePath]

        try {
          directoryListener.stopListener()
        } catch (e) {
          if (e.message == "Invalid argument") {
            // This happens if the dir is deleted and we try and stop listening afterwards
          } else {
            console.error(`Couldn't stop listener for ${sourcePath}: ${e.message}`)
          }
        }

        delete this.subDirsListeners[sourcePath]
      }

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

  stopWatch() {
    this.liraryListener.stopListener()
  }

  shouldIgnore = ({file}) => {
    const {name} = file

    if (name.startsWith(".") || name == "node_modules") {
      return true
    }

    return false
  }

  callback = async ({directoryListener, event, localPath, name, sourcePath, type, ...restArgs}) => {
    for (const destination of this.library.destinations) {
      const targetPath = `${destination}/${localPath}`

      if (type == "created") {
        if (this.verbose) console.log(`Copy ${sourcePath} to ${targetPath}`)

        const dirName = path.dirname(targetPath)
        const lstat = await fs.lstat(sourcePath)

        if (!await pathExists(dirName)) {
          if (this.verbose) console.log(`Path doesn't exists - create it: ${dirName}`)

          await fs.mkdir(dirName, {recursive: true})
        }

        if (lstat.isDirectory()) {
          if (!await pathExists(targetPath)) {
            await fs.mkdir(targetPath, {mode: lstat.mode})
            await fs.chown(targetPath, lstat.uid, lstat.gid)
            await fs.chmod(targetPath, lstat.mode)
          }
        } else if (lstat.isFile()) {
          await fs.copyFile(sourcePath, targetPath, fs.constants.COPYFILE_FICLONE)
        }
      } else if (type == "modified") {
        if (this.verbose) console.log(`Copy ${sourcePath} to ${targetPath}`)

        const dirName = path.dirname(targetPath)
        const lstat = await fs.lstat(sourcePath)

        if (!await pathExists(dirName)) {
          if (this.verbose) console.log(`Path doesn't exists - create it: ${dirName}`)

          await fs.mkdir(dirName, {recursive: true})
        }

        if (lstat.isDirectory()) {
          // FIXME: What was changed? Should we sync something?
        } else if (lstat.isFile()) {
          // FIXME: We should only copy entire file, if the content was changed. Can we detect if the contents was changed? Maybe only props were changed?
          await await fs.copyFile(sourcePath, targetPath, fs.constants.COPYFILE_FICLONE)
        }
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

  async stopWatch() {
    for (const watchedLibrary of this.watchedLibraries) {
      watchedLibrary.stopWatch()
    }
  }
}

export default LibrariesWatcher
