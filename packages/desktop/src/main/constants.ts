import { app } from "electron"

type Channel = "dev" | "beta" | "prod"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

// run.ps1 starts the app from the source folder through a renamed Electron (GotaAssistent.exe), which Electron itself reports as "packaged"
export const FROM_SOURCE = !app.isPackaged || process.execPath.toLowerCase().includes(".gota-electron")

export const UPDATER_ENABLED = !FROM_SOURCE && CHANNEL !== "dev"
