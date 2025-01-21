import fs from "fs/promises"
import InotifyImport from "inotify-remastered-plus"

const {Inotify} = InotifyImport

class DirectoryListener {
  constructor(args) {
    const {path, inotify} = args

    this.args = args
    this.localPath = args.localPath
    this.path = path
    this.subDirsListeners = {}
    this.tempData = {}
    this.watch = inotify.addWatch({
      path,
      watch_for: args.watchFor || Inotify.IN_ALL_EVENTS,
      callback: this.callback
    })
  }

  async watchSubDirs() {
    console.log(`Watching ${this.path}`)

    const files = await fs.readdir(this.path, {withFileTypes: true})

    for (const file of files) {
      const fullPath = `${this.path}/${file.name}`
      let localPath

      if (this.localPath == "") {
        localPath = file.name
      } else {
        localPath = `${this.localPath}/${file.name}`
      }

      if (file.isDirectory()) {
        let shouldIgnore = false

        if (this.args.ignore) {
          shouldIgnore = this.args.ignore({file, localPath, path: fullPath})
        }

        if (!shouldIgnore) {
          const directoryListenerArgs = {...this.args}

          directoryListenerArgs.localPath = localPath
          directoryListenerArgs.path = `${this.path}/${file.name}`

          const directoryListener = new DirectoryListener(directoryListenerArgs)

          await directoryListener.watchSubDirs()

          this.subDirsListeners[fullPath] = directoryListener
        }
      }
    }
  }

  callback = (event) => {
    const {mask, name} = event
    const path = `${this.path}/${name}`
    const localPath = `${this.localPath}/${event.name}`

    if (mask & Inotify.IN_MODIFY) {
      console.log(`${localPath} modified`, {event})

      this.args.callback({
        directoryListener: this,
        event,
        localPath,
        name,
        path,
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
        path,
        type: "created"
      })
    } else if (mask & Inotify.IN_DELETE) {
      this.args.callback({
        directoryListener: this,
        event,
        localPath,
        name,
        path,
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
          path,
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
        path,
        type: "unknown"
      })
    }
  }
}

class WatchedLibrary {
  constructor(library, inotify) {
    this.library = library
    this.liraryListener = new DirectoryListener({
      callback: this.callback,
      localPath: "",
      path: library.source,
      ignore: this.shouldIgnore,
      inotify,
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

  callback = async ({directoryListener, event, localPath, name, path, type}) => {
    for (const destination of this.library.destinations) {
      const targetPath = `${destination}/${localPath}`

      console.log(`${localPath} ${type}`)

      if (type == "created" || type == "modified") {
        console.log(`Copy ${path} to ${targetPath}`)

        await await fs.copyFile(path, targetPath)
      } else if (type == "deleted") {
        console.log(`File ${localPath} was deleted`)
        await fs.unlink(targetPath)

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
  constructor({libraries, ...restProps}) {
    const restPropsKeys = Object.keys(restProps)

    if (restPropsKeys.length > 0) throw new Error(`Unknown properties: ${restPropsKeys}`)
    if (!libraries || !Array.isArray(libraries)) throw new Error(`libraries must be an array`)

    this.libraries = libraries
    this.watchedLibraries = []
    this.inotify = new Inotify()
  }

  async watch() {
    for (const library of this.libraries) {
      const watchedLibrary = new WatchedLibrary(library, this.inotify)

      await watchedLibrary.watch()

      this.watchedLibraries.push(watchedLibrary)
    }
  }
}

export default LibrariesWatcher
