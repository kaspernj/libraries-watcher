import fs from "fs/promises"
import LibrariesWatcher from "./libraries-watcher.js"
import path from "path"
import {fileURLToPath} from "url"

const __filename = fileURLToPath(import.meta.url) // get the resolved path to the file
const __dirname = path.dirname(__filename) // get the name of the directory
const testDirSource = await fs.realpath(`${__dirname}/../spec/support/test-dir/source`)
const testDirTarget = await fs.realpath(`${__dirname}/../spec/support/test-dir/target`)
const config = [
  {
    name: "test",
    source: testDirSource,
    destinations: [testDirTarget]
  }
]

const cleanDir = async (dir) => {
  const files = await fs.readdir(dir)

  for (const file of files) {
    const fullPath = `${dir}/${file}`
    const lstat = await fs.lstat(fullPath)

    if (lstat.isDirectory()) {
      await cleanDir(fullPath)
    } else {
      await fs.unlink(fullPath)
    }
  }
}

const fileExists = async (fullPath) => {
  try {
    await fs.stat(fullPath)

    return true
  } catch (e) {
    if (e.message.startsWith("ENOENT: no such file or directory, stat ")) {
      return false
    }

    throw e
  }
}

describe("libraries-watcher", () => {
  beforeEach(async () => {
    await cleanDir(testDirSource)
    await cleanDir(testDirTarget)
  })

  afterEach(async () => {
    await cleanDir(testDirSource)
    await cleanDir(testDirTarget)
  })

  it("works", async () => {
    const librariesWatcher = new LibrariesWatcher({libraries: config, verbose: false})

    try {
      await librariesWatcher.watch()

      const sourcePath = `${testDirSource}/test.txt`
      const targetPath = `${testDirTarget}/test.txt`

      let sourceTestFileExists = await fileExists(sourcePath)
      let targetTestFileExists = await fileExists(targetPath)

      expect(sourceTestFileExists).toBe(false)
      expect(targetTestFileExists).toBe(false)

      await fs.writeFile(`${testDirSource}/test.txt`, "Test")

      let exists = false

      while (!exists) {
        exists = await fileExists(targetPath)
      }

      sourceTestFileExists = await fileExists(sourcePath)
      targetTestFileExists = await fileExists(targetPath)

      expect(sourceTestFileExists).toBe(true)
      expect(targetTestFileExists).toBe(true)
    } finally {
      await librariesWatcher.stopWatch()
    }
  })
})
