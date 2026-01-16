import DirectoryListener from "./directory-listener.js"

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
    this.verbose = verbose

    this.liraryListener = new DirectoryListener({
      localPath: "",
      ignore: this.shouldIgnore,
      sourcePath: library.source,
      verbose,
      watchedLibrary: this
    })
  }

  /** @returns {Promise<void>} */
  async watch() {
    await this.liraryListener.watch()
  }

  /** @returns {Promise<void>} */
  async stopWatch() {
    await this.liraryListener.stopListener(true)
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
