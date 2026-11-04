// Production entry point: `node server.js` (npm start, Docker CMD).
//
// adapter-node 6 (SvelteKit 3) has no runtime ORIGIN setting: without one it derives the request URL from
// the Host header and assumes https, which breaks auth and CSRF checks on plain-http installs. This wrapper
// makes the public URL a runtime setting instead: it stamps every request with the protocol and host from
// APP_ORIGIN, and tells the adapter to read them (PROTOCOL_HEADER / HOST_HEADER). Client-sent copies of
// those headers are overwritten, so they can't be spoofed. One image therefore works at any URL.
import { createServer } from 'node:http';

const origin = new URL(process.env.APP_ORIGIN || 'http://localhost:3000');
const PROTO = 'x-app-origin-proto';
const HOST = 'x-app-origin-host';
process.env.PROTOCOL_HEADER = PROTO;
process.env.HOST_HEADER = HOST;

// Imported after the env vars are set: the adapter reads them at module load.
const { handler } = await import('./build/handler.js');

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';

const server = createServer((req, res) => {
	req.headers[PROTO] = origin.protocol.slice(0, -1);
	req.headers[HOST] = origin.host;
	handler(req, res, () => {
		res.statusCode = 404;
		res.end('Not found');
	});
});

server.listen(port, host, () => {
	console.log(`Listening on http://${host}:${port} (public URL ${origin.origin})`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
	process.on(sig, () => {
		server.close(() => process.exit(0));
		setTimeout(() => process.exit(0), 10_000).unref();
	});
}
