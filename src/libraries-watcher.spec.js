import fs from "fs/promises"
import LibrariesWatcher from "./libraries-watcher.js"
import path from "path"
import {fileURLToPath} from "url"
import waitFor from "awaitery/src/wait-for.js"
import wait from "awaitery/src/wait.js"

const __filename = fileURLToPath(import.meta.url) // get the resolved path to the file
const __dirname = path.dirname(__filename) // get the name of the directory
const rootPath = await fs.realpath(`${__dirname}/..`)

await fs.mkdir(`${rootPath}/spec/support/test-dir/source`, {recursive: true})
await fs.mkdir(`${rootPath}/spec/support/test-dir/target`, {recursive: true})

const testDirSource = await fs.realpath(`${rootPath}/spec/support/test-dir/source`)
const testDirTarget = await fs.realpath(`${rootPath}/spec/support/test-dir/target`)
const sourceFilePath = `${testDirSource}/test.txt`
const targetFilePath = `${testDirTarget}/test.txt`
const sourceDirPath = `${testDirSource}/testdir`
const targetDirPath = `${testDirTarget}/testdir`
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
      await fs.rm(fullPath, {recursive: true})
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

  it("starts without the test files", async () => {
    let sourceTestFileExists = await fileExists(sourceFilePath)
    let targetTestFileExists = await fileExists(targetFilePath)

    expect(sourceTestFileExists).toBe(false)
    expect(targetTestFileExists).toBe(false)
  })

  it("syncs creation of files in the root", async () => {
    const librariesWatcher = new LibrariesWatcher({libraries: config, verbose: false})

    try {
      await librariesWatcher.watch()
      await fs.writeFile(sourceFilePath, "Test")

      await waitFor(async () => {
        if (!await fileExists(targetFilePath)) throw new Error("Target file doesnt exist")
      })

      await waitFor(async () => {
        const fileContent = await fs.readFile(targetFilePath, "utf8")

        if (fileContent != "Test") {
          throw new Error(`Unexpected file content: ${fileContent}`)
        }
      })
    } finally {
      await librariesWatcher.stopWatch()
    }
  })

  it("syncs creation of files in sub-folders", async () => {
    const librariesWatcher = new LibrariesWatcher({libraries: config, verbose: false})

    await fs.mkdir(`${testDirSource}/testdir1/testdir2`, {recursive: true})
    await fs.mkdir(`${testDirTarget}/testdir1/testdir2`, {recursive: true})

    try {
      await librariesWatcher.watch()
      await fs.writeFile(`${testDirSource}/testdir1/testdir2/testfile`, "Test")

      await waitFor(async () => {
        if (!await fileExists(`${testDirTarget}/testdir1/testdir2/testfile`)) throw new Error("Target file doesnt exist")
      })

      await waitFor(async () => {
        const fileContent = await fs.readFile(`${testDirTarget}/testdir1/testdir2/testfile`, "utf8")

        if (fileContent != "Test") {
          throw new Error(`Unexpected file content: ${fileContent}`)
        }
      })
    } finally {
      await librariesWatcher.stopWatch()
    }
  })

  it("syncs creation of sym-links in sub-folders", async () => {
    const librariesWatcher = new LibrariesWatcher({libraries: config, verbose: false})

    await fs.mkdir(`${testDirSource}/testdir1/testdir2/testdir3/testdir4`, {recursive: true})
    await fs.mkdir(`${testDirTarget}/testdir1/testdir2/testdir3/testdir4`, {recursive: true})

    await fs.writeFile(`${testDirSource}/testdir1/testdir2/Testfile`, "Test")
    await fs.writeFile(`${testDirTarget}/testdir1/testdir2/Testfile`, "Test")

    try {
      await librariesWatcher.watch()
      await fs.symlink("../../Testfile", `${testDirSource}/testdir1/testdir2/testdir3/testdir4/test-symlink`)

      await waitFor(async () => {
        if (!await fileExists(`${testDirTarget}/testdir1/testdir2/testdir3/testdir4/test-symlink`)) throw new Error("Target file doesnt exist")
      })

      const lstats = await fs.lstat(`${testDirTarget}/testdir1/testdir2/testdir3/testdir4/test-symlink`)

      expect(lstats.isSymbolicLink()).toBeTrue()

      const link = await fs.readlink(`${testDirTarget}/testdir1/testdir2/testdir3/testdir4/test-symlink`)

      expect(link).toEqual("../../Testfile")

      await waitFor(async () => {
        const fileContent = await fs.readFile(`${testDirTarget}/testdir1/testdir2/testdir3/testdir4/test-symlink`, "utf8")

        if (fileContent != "Test") {
          throw new Error(`Unexpected file content: ${fileContent}`)
        }
      })
    } finally {
      await librariesWatcher.stopWatch()
    }
  })

  it("syncs deletion of files in the root", async () => {
    const librariesWatcher = new LibrariesWatcher({libraries: config, verbose: false})

    await fs.writeFile(sourceFilePath, "Test")
    await fs.writeFile(targetFilePath, "Test")

    try {
      await librariesWatcher.watch()
      await fs.unlink(sourceFilePath)

      await waitFor(async () => {
        if (await fileExists(targetFilePath)) throw new Error("Target file exists")
      })
    } finally {
      await librariesWatcher.stopWatch()
    }
  })

  it("syncs deletion of files in sub folders", async () => {
    const librariesWatcher = new LibrariesWatcher({libraries: config, verbose: false})

    await fs.mkdir(`${testDirSource}/testdir1/testdir2`, {recursive: true})
    await fs.mkdir(`${testDirTarget}/testdir1/testdir2`, {recursive: true})

    await fs.writeFile(`${testDirSource}/testdir1/testdir2/Testfile`, "Test")
    await fs.writeFile(`${testDirTarget}/testdir1/testdir2/Testfile`, "Test")

    try {
      await librariesWatcher.watch()
      await fs.unlink(`${testDirSource}/testdir1/testdir2/Testfile`)

      await waitFor(async () => {
        if (await fileExists(`${testDirTarget}/testdir1/testdir2/Testfile`)) throw new Error("Target file exists")
      })
    } finally {
      await librariesWatcher.stopWatch()
    }
  })

  it("syncs movals of files in sub folders", async () => {
    const librariesWatcher = new LibrariesWatcher({libraries: config, verbose: false})

    await fs.mkdir(`${testDirSource}/testdir1/testdir2`, {recursive: true})
    await fs.mkdir(`${testDirTarget}/testdir1/testdir2`, {recursive: true})

    await fs.writeFile(`${testDirSource}/testdir1/testdir2/Testfile`, "Test")
    await fs.writeFile(`${testDirTarget}/testdir1/testdir2/Testfile`, "Test")

    try {
      await librariesWatcher.watch()
      await fs.rename(`${testDirSource}/testdir1/testdir2/Testfile`, `${testDirSource}/testdir1/Testfile2`)

      await waitFor(async () => {
        if (await fileExists(`${testDirTarget}/testdir1/testdir2/Testfile`)) throw new Error("Move from path exists")
        if (!await fileExists(`${testDirTarget}/testdir1/Testfile2`)) throw new Error("Move to path doesnt exist")
      })
    } finally {
      await librariesWatcher.stopWatch()
    }
  })

  it("syncs movals of directories in sub folders", async () => {
    const librariesWatcher = new LibrariesWatcher({libraries: config, verbose: false})

    await fs.mkdir(`${testDirSource}/testdir1/testdir2/testdir3/testdir4`, {recursive: true})
    await fs.mkdir(`${testDirTarget}/testdir1/testdir2/testdir3/testdir4`, {recursive: true})

    try {
      await librariesWatcher.watch()
      await fs.rename(`${testDirSource}/testdir1/testdir2/testdir3/testdir4`, `${testDirSource}/testdir1/testdir2/testdir5`)

      await waitFor(async () => {
        if (await fileExists(`${testDirTarget}/testdir1/testdir2/testdir3/testdir4`)) throw new Error("Move from path exists")
        if (!await fileExists(`${testDirTarget}/testdir1/testdir2/testdir5`)) throw new Error("Move to path doesnt exist")
      })
    } finally {
      await librariesWatcher.stopWatch()
    }
  })

  it("syncs changes to files in sub folders", async () => {
    const librariesWatcher = new LibrariesWatcher({libraries: config, verbose: false})

    await fs.mkdir(`${testDirSource}/testdir1/testdir2`, {recursive: true})
    await fs.mkdir(`${testDirTarget}/testdir1/testdir2`, {recursive: true})

    await fs.writeFile(`${testDirSource}/testdir1/testdir2/Testfile`, "Test")
    await fs.writeFile(`${testDirTarget}/testdir1/testdir2/Testfile`, "Test")

    try {
      await librariesWatcher.watch()
      await fs.writeFile(`${testDirSource}/testdir1/testdir2/Testfile`, "Test change")

      await waitFor(async () => {
        const fileContent = await fs.readFile(`${testDirTarget}/testdir1/testdir2/Testfile`, "utf8")

        if (fileContent != "Test change") {
          throw new Error(`Unexpected file content: ${fileContent}`)
        }
      })
    } finally {
      await librariesWatcher.stopWatch()
    }
  })

  it("syncs mods to files in sub folders", async () => {
    const librariesWatcher = new LibrariesWatcher({libraries: config, verbose: false})

    await fs.mkdir(`${testDirSource}/testdir1/testdir2`, {recursive: true})
    await fs.mkdir(`${testDirTarget}/testdir1/testdir2`, {recursive: true})

    await fs.writeFile(`${testDirSource}/testdir1/testdir2/Testfile`, "Test")
    await fs.writeFile(`${testDirTarget}/testdir1/testdir2/Testfile`, "Test")

    try {
      await librariesWatcher.watch()
      await fs.chmod(`${testDirSource}/testdir1/testdir2/Testfile`, 0o600)

      await waitFor(async () => {
        const stat = await fs.stat(`${testDirTarget}/testdir1/testdir2/Testfile`)
        const modeString = stat.mode.toString(8)
        const mode = modeString.substring(modeString.length - 4, modeString.length)

        if (mode != "0600") throw new Error(`Expected ${mode} to be 0600`)
      })
    } finally {
      await librariesWatcher.stopWatch()
    }
  })

  it("syncs mods to directories in sub folders", async () => {
    const librariesWatcher = new LibrariesWatcher({libraries: config, verbose: false})

    await fs.mkdir(`${testDirSource}/testdir1/testdir2`, {recursive: true})
    await fs.mkdir(`${testDirTarget}/testdir1/testdir2`, {recursive: true})

    await fs.writeFile(`${testDirSource}/testdir1/testdir2/Testfile`, "Test")
    await fs.writeFile(`${testDirTarget}/testdir1/testdir2/Testfile`, "Test")

    try {
      await librariesWatcher.watch()
      await wait(500)
      await fs.chmod(`${testDirSource}/testdir1/testdir2`, 0o700)

      await waitFor(async () => {
        const statsSource = await fs.stat(`${testDirSource}/testdir1/testdir2`)
        const modeStringSource = statsSource.mode.toString(8)
        const modeSource = modeStringSource.substring(modeStringSource.length - 4, modeStringSource.length)

        const statsTarget = await fs.stat(`${testDirTarget}/testdir1/testdir2`)
        const modeStringTarget = statsTarget.mode.toString(8)
        const modeTarget = modeStringTarget.substring(modeStringTarget.length - 4, modeStringTarget.length)

        if (modeSource != "0700") throw new Error(`Expected target mode ${modeSource} to be 0700`)
        if (modeTarget != "0700") throw new Error(`Expected target mode ${modeTarget} to be 0700`)
      })
    } finally {
      await librariesWatcher.stopWatch()
    }
  })

  it("syncs creation of dirs", async () => {
    const librariesWatcher = new LibrariesWatcher({libraries: config, verbose: false})

    try {
      await librariesWatcher.watch()
      await fs.mkdir(sourceDirPath)

      await waitFor(async () => {
        if (!await fileExists(targetDirPath)) throw new Error("Target file doesnt exist")
      })
    } finally {
      await librariesWatcher.stopWatch()
    }
  })

  it("syncs deletion of dirs", async () => {
    const librariesWatcher = new LibrariesWatcher({libraries: config, verbose: false})

    await fs.mkdir(sourceDirPath)

    try {
      await librariesWatcher.watch()
      await fs.rm(sourceDirPath, {recursive: true})

      await waitFor(async () => {
        if (await fileExists(targetDirPath)) throw new Error("Target file exists")
      })
    } finally {
      await librariesWatcher.stopWatch()
    }
  })

  it("syncs recursive creation and deletion", async () => {
    const librariesWatcher = new LibrariesWatcher({libraries: config, verbose: false})

    try {
      await librariesWatcher.watch()

      // Create dir
      await fs.mkdir(`${testDirSource}/testdir1`)

      await waitFor(async () => {
        if (!await fileExists(`${testDirTarget}/testdir1`)) throw new Error("Target dir doesnt exist")
      })

      // Create sub-dir
      await fs.mkdir(`${testDirSource}/testdir1/testdir2`)

      await waitFor(async () => {
        if (!await fileExists(`${testDirTarget}/testdir1/testdir2`)) throw new Error("Target dir doesnt exist")
      })

      // Create file in sub-dir
      await fs.writeFile(`${testDirSource}/testdir1/testdir2/testfile`, "Test recursive dirs and files")

      await waitFor(async () => {
        if (!await fileExists(`${testDirTarget}/testdir1/testdir2/testfile`)) throw new Error("Target file doesnt exist")
      })

      await waitFor(async () => {
        const fileContent = await fs.readFile(`${testDirSource}/testdir1/testdir2/testfile`, "utf8")

        if (fileContent != "Test recursive dirs and files") {
          throw new Error(`Unexpected file content: ${fileContent}`)
        }
      })

      // Delete file in sub-dir
      await fs.unlink(`${testDirSource}/testdir1/testdir2/testfile`)

      await waitFor(async () => {
        if (await fileExists(`${testDirTarget}/testdir1/testdir2/testfile`)) throw new Error("Target file exists")
      })

      // Delete first dir recursively
      await fs.rm(`${testDirSource}/testdir1`, {recursive: true})

      await waitFor(async () => {
        if (await fileExists(`${testDirTarget}/testdir1/testdir2`)) throw new Error("Target dir exists")
      })
      await waitFor(async () => {
        if (await fileExists(`${testDirTarget}/testdir1`)) throw new Error("Target dir exists")
      })
    } finally {
      await librariesWatcher.stopWatch()
    }
  })
})
