import path from "path"

/**
 * @param {string} sourcePath
 * @returns {boolean}
 */
export default function ignoreFile(sourcePath) {
  const extName = path.extname(sourcePath)

  if (extName == ".sqlite-journal") {
    return true
  }

  return false
}
