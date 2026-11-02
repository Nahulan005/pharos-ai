import { createApp } from './app.ts'

const rawPort = process.env.PORT ?? '3000'
if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
  console.error('PORT must be an integer between 1 and 65535.')
  process.exitCode = 1
} else {
  const host = process.env.HOST ?? '127.0.0.1'
  const server = createApp().listen(Number(rawPort), host, () => {
    console.log(`PHAROS API listening at http://${host}:${rawPort}`)
  })
  server.on('error', () => { console.error('Could not start PHAROS API. Check the host and whether the port is available.'); process.exitCode = 1 })
  const stop = () => { server.close(); server.closeIdleConnections() }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}
