/**
 * @typedef {object} CallbackFunctionArgs
 * @property {import("chokidar/handler.js").EventName | "changeDir"} event
 * @property {boolean} isDirectory
 * @property {string} localPath
 * @property {string} sourcePath
 * @property {import("fs").Stats} stats
 * @property {import("./watched-library.js").default} watchedLibrary
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

const stub = "Hello world"

export {stub}