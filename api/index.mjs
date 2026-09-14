import app, { databaseReady } from '../server/index.mjs'

await databaseReady

export default app
