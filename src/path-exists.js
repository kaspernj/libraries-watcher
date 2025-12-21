import fs from "fs/promises"

/**
 * @param {string} fileOrDirPath
 * @returns {Promise<boolean>}
 */
export default async function pathExists(fileOrDirPath) {
  try {
    await fs.access(fileOrDirPath)

    return true
  } catch (error) {
    return false
  }
}
