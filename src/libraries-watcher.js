import chokidar from "chokidar"
import fs from "fs/promises"
import path from "path"

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
    const {callback, sourcePath, ignore, localPath, verbose, watchFor, ...restProps} = args
    const restPropsKeys = Object.keys(restProps)

    if (restPropsKeys.length > 0) {
      throw new Error(`${restPropsKeys} are not supported`)
    }

    this.args = args
    this.initial = true
    this.localPath = localPath
    this.sourcePath = sourcePath
    this.tempData = {}
    this.verbose = verbose
  }

  watch() {
    return new Promise((resolve, reject) => {
      this.watchResolve = resolve
      this.watchReject = reject

      this.watcher = chokidar.watch(this.sourcePath, {alwaysStat: true, ignored: this.ignored})
      this.watcher.on("all", this.onChokidarEvent)
      this.watcher.on("ready", this.onChokidarReady)
      this.watcher.on("error", this.onChokidarError)
    })
  }

  onChokidarReady = () => {
    this.initial = false
    this.active = true
    this.watchResolve()
    this.watchResolve = null
    this.watchReject = null
  }

  onChokidarError = (error) => {
    if (this.watchReject) {
      this.watchReject(error)
    } else {
      console.error(error)
    }
  }

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

  async stopListener() {
    if (this.verbose) console.log(`Stop listener for ${this.sourcePath}`)
    if (!this.active) throw new Error(`Listener wasn't active for ${this.sourcePath}`)

    await this.watcher.close()

    this.active = false
    delete this.watcher
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
      isDirectory = await stats.isDirectory()
    }

    if (event == "change") {
      if (this.verbose) console.log(`${localPath} modified`)

      this.args.callback({
        directoryListener: this,
        event,
        localPath,
        name,
        sourcePath,
        type: "modified"
      })
    } else if (event == "mask & Inotify.IN_CLOSE_WRITE") {
      if (this.verbose) console.log(`${localPath} closed for writing`)
    } else if (event == "add" || event == "addDir") {
      this.args.callback({
        directoryListener: this,
        event,
        localPath,
        name,
        sourcePath,
        type: "created"
      })
    } else if (event == "unlink" || event == "unlinkDir") {
      this.args.callback({
        directoryListener: this,
        event,
        localPath,
        name,
        sourcePath,
        type: "deleted"
      })
    } else if (event == "mask & Inotify.IN_MOVED_FROM") {
      this.tempData.cookie = event.cookie
      this.tempData.movedFrom = event.name
    } else if (event == "mask & Inotify.IN_MOVED_TO") {
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
  constructor({library, verbose, ...restProps}) {
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

  async watch() {
    await this.liraryListener.watch()
  }

  async stopWatch() {
    await this.liraryListener.stopListener()
  }

  shouldIgnore = ({fileName}) => {
    if (fileName.startsWith(".") || fileName == "node_modules") {
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
  }

  async watch() {
    for (const library of this.libraries) {
      const watchedLibrary = new WatchedLibrary({library, verbose: this.verbose})

      await watchedLibrary.watch()

      this.watchedLibraries.push(watchedLibrary)
    }
  }

  async stopWatch() {
    for (const watchedLibrary of this.watchedLibraries) {
      await watchedLibrary.stopWatch()
    }
  }
}

export default LibrariesWatcher
