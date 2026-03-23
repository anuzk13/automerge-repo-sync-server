// @ts-check
import fs from "fs"
import https from "https"
import path from "path"
import { fileURLToPath } from "url"
import express from "express"
import { WebSocketServer } from "ws"
import { Repo } from "@automerge/automerge-repo"
import { WebSocketServerAdapter } from "@automerge/automerge-repo-network-websocket"
import { NodeFSStorageAdapter } from "@automerge/automerge-repo-storage-nodefs"

import os from "os"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export class Server {
  /** @type WebSocketServer */
  #socket

  /** @type ReturnType<import("express").Express["listen"]> */
  #server

  /** @type {((value: any) => void)[]} */
  #readyResolvers = []

  #isReady = false

  /** @type Repo */
  #repo

  constructor() {
    const dir =
      process.env.DATA_DIR !== undefined ? process.env.DATA_DIR : ".amrg"
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir)
    }

    var hostname = os.hostname()

    this.#socket = new WebSocketServer({ noServer: true })

    const PORT =
      process.env.PORT !== undefined ? parseInt(process.env.PORT) : 3030
    const app = express()
    app.use(express.static("public"))

    const config = {
      network: [new WebSocketServerAdapter(this.#socket, 60000)],
      storage: new NodeFSStorageAdapter(dir),
      /** @ts-ignore @type {(import("@automerge/automerge-repo").PeerId)}  */
      peerId: `storage-server-${hostname}`,
      // Since this is a server, we don't share generously — meaning we only sync documents they already
      // know about and can ask for by ID.
      sharePolicy: async () => false,
    }
    this.#repo = new Repo(config)

    app.get("/", (req, res) => {
      res.send(`👍 @automerge/automerge-repo-sync-server is running`)
    })

    const certsDir = path.resolve(__dirname, "..", "certs")
    const keyPath = path.join(certsDir, "key.pem")
    const certPath = path.join(certsDir, "cert.pem")

    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
      const httpsServer = https.createServer(
        { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) },
        app
      )
      this.#server = httpsServer.listen(PORT, () => {
        this.#isReady = true
        this.#readyResolvers.forEach((resolve) => resolve(true))
      })
    } else {
      this.#server = app.listen(PORT, () => {
        console.log(`Listening on ws://localhost:${PORT}. No TLS certs found in ${certsDir}`)
        this.#isReady = true
        this.#readyResolvers.forEach((resolve) => resolve(true))
      })
    }

    this.#repo.storageId().then((storageId) => {
      console.log(`Storage ID: ${storageId}`)
    })

    this.#server.on("upgrade", (request, socket, head) => {
      this.#socket.handleUpgrade(request, socket, head, (socket) => {
        this.#socket.emit("connection", socket, request)
      })
    })
  }

  async ready() {
    if (this.#isReady) {
      return true
    }

    return new Promise((resolve) => {
      this.#readyResolvers.push(resolve)
    })
  }

  close() {
    this.#socket.close()
    this.#server.close()
  }
}
